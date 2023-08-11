const allCookies = require( '../cookies.json' );

/**
 * @param {import('puppeteer').Page} page
 * @param {string} username
 */
module.exports = async ( page, username ) => {
	const strippedCookies = allCookies[ username ];
	if ( !strippedCookies ) {
		throw new Error( `No cookie found for ${username}` );
	}
	const cookies = strippedCookies.map( ( cookie ) => {
		return {
			domain: 'localhost',
			...cookie
		};
	} );

	await page.setCookie( ...cookies );

	console.log( 'Cookie state restored' );
};
