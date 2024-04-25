#!/usr/bin/env node
const util = require( 'util' );
const exec = util.promisify( require( 'child_process' ).exec );
const LATEST_RELEASE_BRANCH = 'latest-release';
const MAIN_BRANCH = 'master';
const SimpleSpawn = require( './src/SimpleSpawn' );
const simpleSpawn = new SimpleSpawn();
const fs = require( 'fs' );
const CONTEXT_PATH = `${__dirname}/context.json`;
const GROUP_CONFIG = require( './config/groupConfig' );
const A11Y_GROUP_CONFIG = require( './config/a11yGroupConfig' );

/*
 * @param {string[]} opts
 * @return {string[]}
 */
function getComposeOpts( opts ) {
	return [
		'--progress=plain',
		'--project-directory', __dirname,
		'-f', `${__dirname}/docker-compose.yml`,
		...opts
	];
}

let context;
if ( fs.existsSync( CONTEXT_PATH ) ) {
	try {
		context = JSON.parse( fs.readFileSync( CONTEXT_PATH ).toString() );
	} catch ( e ) {
		context = {};
	}
} else {
	context = {};
}

/**
 * @return {Promise<string>}
 */
async function getLatestReleaseBranch() {
	// Get the latest branch version that starts with a digit.
	const { stdout } = await exec( 'git ls-remote -h --sort="-version:refname" https://gerrit.wikimedia.org/r/mediawiki/core --patterns "refs/heads/wmf/[0-9]*" | head -1' );
	return `origin/${stdout.split( 'refs/heads/' )[ 1 ].trim()}`;
}

/**
 * @return {Promise<string>}
 */
async function getLatestCodexVersion() {
	// Get the version tag with the highest number
	const { stdout } = await exec( 'git ls-remote -t --sort="-version:refname" https://gerrit.wikimedia.org/r/design/codex --patterns "refs/tags/v[0-9.]*" | head -1' );
	return `${stdout.split( 'refs/tags/' )[ 1 ].trim()}`;
}

/**
 * @param {'test'|'reference'} type
 * @param {'mobile'|'desktop'|'desktop-dev'|'echo|campaign-events'} group
 * @param {string} relativePath Relative path to report.
 * @param {boolean} nonInteractive
 * @return {Promise<undefined>}
 */
async function writeBannerAndOpenReportIfNecessary( type, group, relativePath, nonInteractive ) {
	const filePathFull = `${__dirname}/${relativePath}/index.html`;
	const markerString = '<div id="root">';
	try {
		if ( type === 'reference' ) {
			return;
		}
		const ctx = context[ group ];
		const date = new Date();
		const fileString = fs.readFileSync( filePathFull ).toString().replace(
			markerString,
			`<div id="mw-message-box" style="color: #000; box-sizing: border-box;
margin-bottom: 16px;border: 1px solid; padding: 12px 24px;
word-wrap: break-word; overflow-wrap: break-word; overflow: hidden;
background-color: #eaecf0; border-color: #a2a9b1;">
<h2>Test group: <strong>${group}</strong></h2>
<p>Comparing ${ctx.reference}${ctx.description} against ${ctx.test}.</p>
<p>Test ran on ${date}</p>
</div>
<script>
(function() {
const daysElapsed = ( new Date() - new Date('${date}') ) / ( 1000 * 60 * 60 * 24);
  const warning = document.createElement( 'em' );
  const msg = document.getElementById( 'mw-message-box' );
  warning.textContent = 'This test is < ' + Math.round( parseInt( daysElapsed, 10 ) ) + ' days old.';
  msg.appendChild( warning );
  if ( daysElapsed > 1 ) {
    msg.style.backgroundColor = 'red';
  }
}());
</script>
${markerString}`
		);
		fs.writeFileSync( filePathFull, fileString );
		if ( !nonInteractive ) {
			await simpleSpawn.spawn( 'open', [ filePathFull ] );
		}
	} catch ( e ) {
		console.log( `Could not open report, but it is located at ${filePathFull}` );
		console.error( e );
	}
}

/**
 * @param {string} groupName
 * @param {boolean} a11y
 * @return {string} path to configuration file.
 * @throws {Error} for unknown group
 */
const getGroupConfig = ( groupName, a11y ) => {
	const c = a11y ? A11Y_GROUP_CONFIG[ groupName ] : GROUP_CONFIG[ groupName ];
	if ( !c ) {
		throw new Error( `Unknown test group: ${groupName}` );
	}
	return `config/${c.config}`;
};

/**
 * @param {string} relativePath Relative path to folder.
 */
function removeFolder( relativePath ) {
	fs.rmSync( `${__dirname}/${relativePath}`, { recursive: true, force: true } );
}

/**
 * @typedef {Object} CommandOptions
 * @property {string[]} [changeId]
 * @property {string} [branch]
 * @property {string[]} [repoBranch]
 * @property {string} group
 */

/**
 * @param {'test'|'reference'} type
 * @param {CommandOptions} opts
 * @param {boolean} [runSilently]
 */
async function processCommand( type, opts, runSilently = false ) {
	try {
		const group = opts.group;
		const configFile = getGroupConfig( group, opts.a11y );
		const config = require( `${__dirname}/${configFile}` );

		setEnvironmentFlagIfGroup( 'ENABLE_WIKILAMBDA', 'wikilambda', group );

		const activeBranch = await getActiveBranch( opts );
		const description = getDescription( opts );
		updateContext( group, type, activeBranch, description );

		await prepareDockerEnvironment( opts );

		const { stdout } = await exec( './purgeParserCache.sh' );
		console.log( stdout );

		if ( opts.a11y ) {
			return await runA11yRegressionTests( type, configFile, opts.logResults, opts );
		} else {
			return await runVisualRegressionTests(
				type, config, group, runSilently, configFile, opts.resetDb
			);
		}
	} catch ( err ) {
		console.error( err );
		// eslint-disable-next-line no-process-exit
		process.exit( 1 );
	}
}

async function getActiveBranch( opts ) {
	if ( opts.branch === LATEST_RELEASE_BRANCH ) {
		return await getLatestReleaseBranchAndUpdateOpts( opts );
	} else if ( opts.branch !== 'master' ) {
		return opts.branch;
	} else {
		return opts.changeId ? opts.changeId[ 0 ] : opts.branch;
	}
}

async function getLatestReleaseBranchAndUpdateOpts( opts ) {
	opts.branch = await getLatestReleaseBranch();
	const codexTag = await getLatestCodexVersion();
	opts.repoBranch = [ ...( opts.repoBranch ?? [] ), `design/codex:${codexTag}` ];
	console.log( `Using latest branch "${opts.branch}" (for Codex, "${codexTag}")` );
	return opts.branch;
}

function getDescription( opts ) {
	let description = '';

	if ( opts.changeId ) {
		description = ` (Includes ${opts.changeId.join( ',' )})`;
	}

	if ( opts.repoBranch && opts.repoBranch.length > 0 ) {
		description += ` (with custom branches: ${opts.repoBranch.join( ', ' )})`;
	}

	return description;
}

function updateContext( group, type, activeBranch, description ) {
	if ( !context[ group ] ) {
		context[ group ] = { description };
	}
	if ( type === 'reference' ) {
		context[ group ].description = description;
	}
	context[ group ][ type ] = activeBranch;

	fs.writeFileSync( `${__dirname}/context.json`, JSON.stringify( context ) );
}

async function prepareDockerEnvironment( opts ) {
	await simpleSpawn.spawn( './build-base-regression-image.sh' );
	await simpleSpawn.spawn( './start.sh' );
	await simpleSpawn.spawn(
		'docker',
		[ 'compose', ...getComposeOpts( [ 'exec', ...( process.env.NONINTERACTIVE ? [ '-T' ] : [] ), 'mediawiki', '/src/main.js', JSON.stringify( opts ) ] ) ]
	);
}

async function runA11yRegressionTests( type, configFile, logResults, opts ) {
	const { resetDb } = opts;
	return simpleSpawn.spawn(
		'docker',
		[ 'compose', ...getComposeOpts( [ 'run', ...( process.env.NONINTERACTIVE ? [ '--no-TTY' ] : [] ), '--rm', 'a11y-regression', type, configFile, !!logResults ] ) ]
	).finally( async () => {
		if ( resetDb ) {
			await resetDatabase();
		}
	} );
}

async function runVisualRegressionTests( type, config, group, runSilently, configFile, resetDb ) {
	if ( type === 'test' ) {
		removeFolder( config.paths.bitmaps_test );
	}

	const finished = await simpleSpawn.spawn(
		'docker',
		[ 'compose', ...getComposeOpts( [ 'run', ...( process.env.NONINTERACTIVE ? [ '--no-TTY' ] : [] ), '--rm', 'visual-regression', type, '--config', configFile ] ) ]
	).then( async () => {
		await writeBannerAndOpenReportIfNecessary(
			type, group, config.paths.html_report, runSilently || process.env.NONINTERACTIVE
		);
	}, async ( err ) => {
		await handleTestError( err, type, group, config.paths.html_report, runSilently );
	} ).finally( async () => {
		if ( resetDb ) {
			await resetDatabase();
		}
	} );

	return finished;
}

async function handleTestError( err, type, group, reportPath, runSilently ) {
	console.error( err );
	if ( err.message.includes( '130' ) ) {
		if ( !runSilently ) {
			// eslint-disable-next-line no-process-exit
			process.exit( 1 );
		}
	}

	if ( err.message.includes( 'Exit with error code 1' ) ) {
		await writeBannerAndOpenReportIfNecessary(
			type, group, reportPath, process.env.NONINTERACTIVE
		);
		if ( !runSilently ) {
			// eslint-disable-next-line no-process-exit
			process.exit( 1 );
		}
	}

	if ( runSilently ) {
		return Promise.resolve();
	} else {
		throw err;
	}
}

async function resetDatabase() {
	console.log( 'Resetting database state...' );
	await exec( './reset-db.sh' );
}

function setEnvironmentFlagIfGroup( envVarName, soughtGroup, group ) {
	process.env[ envVarName ] = group === soughtGroup ? 'true' : 'false';
}

function setupCli() {
	const { program } = require( 'commander' );
	const a11yOpt = /** @type {const} */ ( [
		'-a, --a11y',
		'Run automated a11y tests in addition to visual regression.'
	] );
	const logResultsOpt = /** @type {const} */ ( [
		'-l, --logResults',
		'Log accessibility results to statsv.'
	] );
	const branchOpt = /** @type {const} */ ( [
		'-b, --branch <name-of-branch>',
		`Name of branch. Can be "${MAIN_BRANCH}" or a release branch (e.g. "origin/wmf/1.37.0-wmf.19"). Use "${LATEST_RELEASE_BRANCH}" to use the latest wmf release branch.`,
		'master'
	] );
	const changeIdOpt = /** @type {const} */ ( [
		'-c, --change-id <Change-Id...>',
		'The Change-Id to use. Use multiple flags to use multiple Change-Ids (e.g. -c <Change-Id> -c <Change-Id>)'
	] );
	const repoBranchOpt = /** @type {const} */ ( [
		'--repo-branch <repo:branch...>',
		'Override the branch name for a specific repository. Specify the repository name, then a colon, then the branch name, e.g. `mediawiki/skins/Vector:new-vector-features`. Use multiple flags to override branches for multiple repositories.'
	] );
	const groupOpt = /** @type {const} */ ( [
		'-g, --group <(mobile|desktop|echo|campaign-events)>',
		'The group of tests to run. If omitted the group will be desktop.',
		'desktop'
	] );
	const directoryOpt = /** @type {const} */ ( [
		'-d, --directory <path>',
		'Where to save the file',
		'report'
	] );
	const priorityOpt = /** @type {const} */ ( [
		'-p, --priority <number>',
		'Only run jobs which match the provided priority',
		'0'
	] );
	const resetDbOpt = /** @type {const} */ ( [
		'--reset-db',
		'Reset the database after running a test group. This will destroy all data that is currently in the database.'
	] );

	program
		.name( 'pixel.js' )
		.description( 'Welcome to the pixel CLI to perform visual regression testing' );

	program
		.command( 'reference' )
		.description( 'Create reference (baseline) screenshots and delete the old reference screenshots.' )
		.requiredOption( ...branchOpt )
		.option( ...a11yOpt )
		.option( ...logResultsOpt )
		.option( ...changeIdOpt )
		.option( ...repoBranchOpt )
		.option( ...groupOpt )
		.option( ...resetDbOpt )
		.action( ( opts ) => {
			processCommand( 'reference', opts );
		} );

	program
		.command( 'test' )
		.description( 'Create test screenshots and compare them against the reference screenshots.' )
		.requiredOption( ...branchOpt )
		.option( ...a11yOpt )
		.option( ...logResultsOpt )
		.option( ...changeIdOpt )
		.option( ...repoBranchOpt )
		.option( ...groupOpt )
		.option( ...resetDbOpt )
		.action( ( opts ) => {
			processCommand( 'test', opts );
		} );

	program
		.command( 'runAll' )
		.description( 'Runs all the registered tests and generates a report.' )
		.option( ...branchOpt )
		.option( ...changeIdOpt )
		.option( ...repoBranchOpt )
		.option( ...groupOpt )
		.option( ...priorityOpt )
		.option( ...directoryOpt )
		.option( ...resetDbOpt )
		.action( async ( opts ) => {
			let html = '';
			const priority = parseInt( opts.priority, 10 );
			const outputDir = opts.directory;
			if ( !fs.existsSync( outputDir ) ) {
				fs.mkdirSync( outputDir );
			}

			// Update keys in a11y group config to avoid duplicate group names
			const updatedA11yGroupConfig = {};
			for ( const key in A11Y_GROUP_CONFIG ) {
				updatedA11yGroupConfig[ key + '-a11y' ] = A11Y_GROUP_CONFIG[ key ];
			}

			const groups = { ...GROUP_CONFIG, ...updatedA11yGroupConfig };
			for ( const [ groupName, groupDef ] of Object.entries( groups ) ) {
				const group = groupDef.a11y ? groupName.slice( 0, -5 ) : groupName;
				const name = groupDef.name || group;
				html += `<li><a href="${groupName}/index.html">${name} (${groupName})</a></li>`;
				const groupPriority = groupDef.priority || 0;
				if ( groupPriority <= priority ) {
					console.log( `*************************
*************************
*************************
*************************
Running regression group "${groupName}"
*************************
*************************
*************************
*************************` );
					try {
						const changeId = opts.changeId;
						let msg = '';
						if ( changeId ) {
							msg = `(with ${changeId.join( ',' )}).`;
						}
						console.log( `Running reference group ${msg}` );
						await processCommand( 'reference', {
							branch: LATEST_RELEASE_BRANCH,
							changeId: opts.changeId,
							group,
							a11y: groupDef.a11y,
							logResults: groupDef.logResults
						}, true );
						await processCommand( 'test', {
							branch: 'master',
							group,
							a11y: groupDef.a11y,
							logResults: groupDef.logResults
						}, true );
					} catch ( e ) {
						// Continue.
						console.log( 'Error occurred' );
						console.error( e );
					}
				} else {
					console.log( `*************************
Skipping group "${groupName}" due to priority.
*************************` );
				}
			}
			const indexFilePath = `${outputDir}/index.html`;
			const { stdout } = await exec( `source ./src/makeReportIndex.sh && makeReport "${indexFilePath}" "${html.replace( /"/g, '\\"' )}"` );
			console.log( stdout );
			if ( !process.env.NONINTERACTIVE ) {
				await simpleSpawn.spawn( 'open', [ indexFilePath ] );
			}
		} );
	program.parse();
}

setupCli();
