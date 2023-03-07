const fastForwardAnimations = require( './fastForwardAnimations' );
const waitForIdle = require( './waitForIdle' );

/**
 * Runs after onReady event on all scenarios -- use for simulating interactions.
 *
 * @param {import('puppeteer').Page} page
 * @param {import('backstopjs').Scenario} scenario
 */
module.exports = async ( page, scenario ) => {
	console.log( 'SCENARIO > ' + scenario.label );
	const label = scenario.label;
	const hashtags = label.match( /(#[^ ,)]*)/g ) || [];

	// Make sure the main skin JavaScript module has loaded.
	await require( './jsReady' )( page, hashtags );

	// These only apply to Vector 2022
	if ( hashtags.includes( '#vector-2022' ) ) {
		await require( './limitedWidth' )( page, hashtags );
		await require( './pinnableElementState' )( page, hashtags, 'main-menu' );
		await require( './pinnableElementState' )( page, hashtags, 'page-tools' );
		await require( './pinnableElementState' )( page, hashtags, 'toc' );
		// Only 1 dropdown can be open at time
		await require( './userLinksDropdownState' )( page, hashtags );
		await require( './mainMenuDropdownState' )( page, hashtags );
		await require( './pageToolsDropdownState' )( page, hashtags );
		await require( './tocDropdownState' )( page, hashtags );
	}

	if ( hashtags.includes( '#toggle-toc-subsections' ) ) {
		await require( './toggleTocSubsections' )( page );
	}

	// These only apply to Minerva
	if ( hashtags.includes( '#minerva' ) ) {
		await require( './minerva/mainMenuState' )( page, hashtags );
	}

	// Run Echo handlers if necessary.
	if ( hashtags.includes( '#echo' ) ) {
		await require( './echo.js' )( page, hashtags );
	}

	if ( hashtags.includes( '#scroll' ) ) {
		await require( './scroll.js' )( page );
		// eslint-disable-next-line no-restricted-properties
		await page.waitForTimeout( 500 );
	}

	if ( hashtags.includes( '#search-focus' ) ) {
		await require( './search.js' )( page, hashtags );
	}

	// add more ready handlers here...
	// Note: These calls should always be last.

	// Wait for any images to finish loading.
	await page.waitForNetworkIdle();
	// Wait for the main thread to have an idle period.
	await waitForIdle( page );
	// Fast forward through any css transitions/web animations that are happening.
	await fastForwardAnimations( page );

	/**
	 * Remove the .sidebar-toc-list-item-active, .vector-toc-list-item-active
	 * class from the item in the toc What is focused is variable, so can lead to
	 * false positives in pixel.  Knowing it exists is enough to know it is
	 * working.
	 */
	await page.evaluate( () => {
		document.querySelectorAll(
			'.sidebar-toc-list-item-active, .vector-toc-list-item-active'
		).forEach( ( node ) => {
			node.classList.remove(
				'sidebar-toc-list-item-active', 'vector-toc-list-item-active'
			);
		} );
		return true;
	} );
};
