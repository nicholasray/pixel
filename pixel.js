#!/usr/bin/env node
const util = require( 'util' );
const exec = util.promisify( require( 'child_process' ).exec );
const LATEST_RELEASE_BRANCH = 'latest-release';
const MAIN_BRANCH = 'master';
const BatchSpawn = require( './src/BatchSpawn' );
const batchSpawn = new BatchSpawn( 1 );
const REPORT_ORIGIN = 'http://localhost:4000';
const { program, Option } = require( 'commander' );
const pathResolve = require( 'path' ).resolve;

/*
 * @param {string[]} opts
 * @return {string[]}
 */
function getComposeOpts( opts ) {
	return [
		'--project-directory', __dirname,
		'-f', `${__dirname}/docker-compose.yml`,
		...opts
	];
}

/**
 * Removes all images, containers, networks, and volumes associated with Pixel.
 * This will often be used after updates to the Docker images and/or volumes and
 * will reset everything so that Pixel starts with a clean slate.
 *
 * @return {Promise}
 */
async function cleanCommand() {
	await batchSpawn.spawn( 'docker', [ 'compose', ...getComposeOpts( [ 'down', '--rmi', 'all', '--volumes', '--remove-orphans' ] ) ] );
}

/**
 * @return {Promise<string>}
 */
async function getLatestReleaseBranch() {
	const { stdout } = await exec( 'git ls-remote -h --sort="-version:refname" https://gerrit.wikimedia.org/r/mediawiki/core | head -1' );
	return `origin/${stdout.split( 'refs/heads/' )[ 1 ].trim()}`;
}

/**
 * @param {string} reportLocation
 */
async function copyReportToHost( reportLocation ) {
	try {
		// Save report to host at the location specified by `path`.
		await batchSpawn.spawn(
			'docker',
			[ 'compose', ...getComposeOpts( [ 'cp', 'visual-regression-reporter:/pixel/report', reportLocation ] ) ]
		);
	} catch ( e ) {
		console.log( 'Could not copy report to host', e );
	}
}

/**
 * @param {'test'|'reference'} type
 * @param {string} group
 * @param {string} [path] Path that the report should be written.
 * @return {Promise<undefined>}
 */
async function openReportIfNecessary( type, group, path ) {
	const reportUrl = `${REPORT_ORIGIN}/${group}`;

	try {
		if ( type === 'reference' ) {
			return;
		}

		if ( path ) {
			path = pathResolve( path );
			copyReportToHost( pathResolve( path ) );
		}

		await batchSpawn.spawn( 'open', [ reportUrl ] );

		console.log( `Report located at ${reportUrl}${path ? ` and at ${path}` : ''}` );
	} catch ( e ) {
		console.log( `Could not open report, but it is located at ${reportUrl}` );
	}
}

/**
 * Resets the database to the physical backup downloaded from the
 * Dockerfile.database docker image.
 */
async function resetDb() {
	// Mysql server needs to be shutdown before restoring a physical backup:
	// See: https://www.percona.com/doc/percona-xtrabackup/2.1/xtrabackup_bin/restoring_a_backup.html
	await batchSpawn.spawn(
		'docker',
		[ 'compose', ...getComposeOpts( [ 'stop', 'database' ] ) ]
	);

	// Run seedDb.sh script which rsyncs the physical backup into the mysql folder.
	await batchSpawn.spawn(
		'docker',
		[ 'compose', ...getComposeOpts( [ 'run', '--rm', '--entrypoint', 'bash -c "/docker-entrypoint-initdb.d/seedDb.sh"', 'database' ] ) ]
	);

	// Start mysql server.
	await batchSpawn.spawn(
		'docker',
		[ 'compose', ...getComposeOpts( [ 'up', '-d', 'database' ] ) ]
	);
}

/**
 * @param {any} opts
 */
async function processCommand( opts ) {
	try {
		// Check if `-b latest-release` was used and, if so, set opts.branch to the
		// latest release branch.
		if ( opts.branch === LATEST_RELEASE_BRANCH ) {
			opts.branch = await getLatestReleaseBranch();

			console.log( `Using latest release branch "${opts.branch}"` );
		}

		// Reset the database if `--reset-db` option is passed.
		if ( opts.resetDb ) {
			await resetDb();
		}

		// Start docker containers.
		await batchSpawn.spawn(
			'docker',
			[ 'compose', ...getComposeOpts( [ 'up', '-d' ] ) ]
		);

		// Execute main.js.
		await batchSpawn.spawn(
			'docker',
			[ 'compose', ...getComposeOpts( [ 'exec', '-T', 'mediawiki', '/src/main.js', JSON.stringify( opts ) ] ) ]
		);
		// Execute Visual regression tests.
		await batchSpawn.spawn(
			'docker',
			[ 'compose', ...getComposeOpts( [ 'run', '--rm', 'visual-regression', JSON.stringify( opts ) ] ) ]
		).then( async () => {
			await openReportIfNecessary( opts.type, opts.group, opts.output );
		}, async ( /** @type {Error} */ err ) => {
			if ( err.message.includes( '130' ) ) {
				// If user ends subprocess with a sigint, exit early.
				return;
			}

			if ( err.message === 'Exit with error code 10' ) {
				return openReportIfNecessary( opts.type, opts.group, opts.output );
			}

			throw err;
		} );
	} catch ( err ) {
		console.error( err );
		// eslint-disable-next-line no-process-exit
		process.exit( 1 );
	}
}

function setupCli() {
	const branchOpt = /** @type {const} */ ( [
		'-b, --branch <name-of-branch>',
		`Name of branch. Can be "${MAIN_BRANCH}" or a release branch (e.g. "origin/wmf/1.39.0-wmf.10"). Use "${LATEST_RELEASE_BRANCH}" to use the latest wmf release branch.`,
		'master'
	] );
	const changeIdOpt = /** @type {const} */ ( [
		'-c, --change-id <Change-Id...>',
		'The Change-Id to use. Use multiple flags to use multiple Change-Ids (e.g. -c <Change-Id> -c <Change-Id>)'
	] );
	const groupOpt = new Option(
		'-g, --group <(mobile|desktop|echo)>',
		'The group of tests to run. If omitted the group will be desktop.',
		'desktop'
	)
		.default( 'desktop' )
		.choices( [ 'mobile', 'desktop', 'echo' ] );
	const resetDbOpt = /** @type {const} */ ( [
		'--reset-db',
		'Reset the database before running the test. This will destroy all data that is currently in the database.'
	] );

	program
		.name( 'pixel.js' )
		.description( 'Welcome to the pixel CLI to perform visual regression testing' );

	program
		.command( 'reference' )
		.description( 'Create reference (baseline) screenshots and delete the old reference screenshots.' )
		.requiredOption( ...branchOpt )
		.option( ...changeIdOpt )
		.option( ...resetDbOpt )
		.addOption( groupOpt )
		.action( ( opts ) => {
			opts = Object.assign( {}, opts, { type: 'reference' } );

			processCommand( opts );
		} );

	program
		.command( 'test' )
		.description( 'Create test screenshots and compare them against the reference screenshots.' )
		.requiredOption( ...branchOpt )
		.option( ...changeIdOpt )
		.option( ...resetDbOpt )
		.addOption( groupOpt )
		.addOption(
			new Option(
				'-o, --output [path-to-report]',
				'Save static report to a given path. Defaults to the current working directory.',
				'pixel-report'
			).preset( './pixel-report' )
		)
		.action( ( opts ) => {
			opts = Object.assign( {}, opts, { type: 'test' } );

			processCommand( opts );
		} );

	program
		.command( 'reset-db' )
		.description( 'Destroys all data in the database and resets it.' )
		.action( async () => {
			await resetDb();
		} );

	program
		.command( 'stop' )
		.description( 'Stops all Docker containers associated with Pixel' )
		.action( async () => {
			await batchSpawn.spawn(
				'docker',
				[ 'compose', ...getComposeOpts( [ 'stop' ] ) ]
			);
		} );

	program
		.command( 'clean' )
		.description( 'Removes all containers, images, networks, and volumes associated with Pixel so that it can start with a clean slate. If Pixel is throwing errors, try running this command.' )
		.action( async () => {
			await cleanCommand();
		} );

	program.parse();
}

setupCli();
