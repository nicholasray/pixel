const configDesktop = require( './configDesktop.js' );
const utils = require( './utils' );

const BASE_URL = process.env.PIXEL_MW_SERVER;
const tests = [
	{
		label: 'Tree (#minerva #mobile)',
		path: '/wiki/Tree'
	},
	{
		label: 'Test (#minerva #mobile)',
		path: '/wiki/Test'
	},
	{
		label: 'Test (#minerva #mobile #logged-in)',
		path: '/wiki/Test?useskin=minerva&useformat=mobile'
	},
	{
		label: 'Test (#minerva #mobile #mainmenu-open)',
		path: '/wiki/Test'
	},
	{
		label: 'Test (#minerva #mobile #logged-in #mainmenu-open)',
		path: '/wiki/Test'
	},
	{
		label: 'Filled in user page (#minerva #mobile)',
		path: '/wiki/User:Admin'
	},
	{
		label: 'User subpage (#minerva #mobile)',
		path: '/wiki/User:Admin/common.js'
	},
	{
		label: 'Non-existent user page (#minerva #mobile)',
		path: '/wiki/User:Echo1'
	}
];

const scenarios = tests.map( ( test ) => {
	const isMinerva = test.label.indexOf( '#minerva' );
	const isMobile = test.label.indexOf( '#mobile' );
	const flags = {};
	if ( isMobile ) {
		flags.useformat = 'mobile';
	}
	if ( isMinerva ) {
		flags.useskin = 'minerva';
	}

	return utils.addFeatureFlagQueryStringsToScenario(
		Object.assign( {
			url: `${BASE_URL}${test.path}`,
			selectors: [ 'viewport' ]
		}, test ),
		flags
	);
} );

module.exports = Object.assign( {}, configDesktop, {
	scenarios,
	paths: utils.makePaths( 'mobile' )
} );
