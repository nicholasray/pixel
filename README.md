# Pixel

![Visual regression HTML reporter showing failing and passing tests](reporter.png)

🚨 **Pixel is a work in progress and experimental. Only use it when you're feeling dangerous.** 🚨

Pixel is a visual regression tool for MediaWiki developers/QA engineers that
helps you replace manual testing with automated tests that catch web ui
regressions before users see them. It *currently* integrates
[BackstopJS](https://github.com/garris/BackstopJS),
[MediaWiki-Docker](https://www.mediawiki.org/wiki/MediaWiki-Docker), and Docker
under the hood.

Check out the hourly reports Pixel has generated at https://pixel.wmcloud.org
which compare the latest release branch against master, and read
[T302246](https://phabricator.wikimedia.org/T302246) for the motivation behind
the tool.

## Quick Start

Install Pixel from npm using Node 15 or later.

```sh
npm i -g @nicholasray/pixel
```

Install [Docker](https://docs.docker.com/get-docker/) and [Docker
Compose](https://docs.docker.com/compose/install/) and make sure Docker is
running.  Pixel runs in multiple Docker containers to eliminate inconsistent
rendering issues across environments and to make it easier to replicate any
issue locally.

## Usage

Your workflow will usually involve the following ordered steps:

### 1) Take reference (baseline) screenshots with `master` or release branch code

If you want to checkout the latest code in `master` or `main` from MediaWiki
core and all of its installed extensions and skins and then take reference
screenshots that your test screenshots (step 2) will be compared against, then:

```sh
pixel reference
```

Or if you want the reference to be the latest release branch:

```sh
pixel reference -b latest-release
```

Or if you want the reference to be a certain release branch:

```sh
pixel reference -b origin/wmf/1.39.0-wmf.12
```

The `desktop` tests run by default. If you want to run the mobile visual
regression test suite pass the `--group mobile` flag.

### 2) Take test screenshots with changed code

If you want to pull a change or multiple changes down from gerrit, take
screenshots with these changes on top of master and then compare these
screenshots against the reference screenshots, then

```sh
pixel test -c Iff231a976c473217b0fa4da1aa9a8d1c2a1a19f2
```

Note that although change id `Iff231a976c473217b0fa4da1aa9a8d1c2a1a19f2` has a
`Depends-On` dependency, it is the only change that needs to be passed. Pixel
will figure out and pull down the rest of the dependencies provided that it has
the relevant repositories (set in [repositories.json](repositories.json)).

Similar to the `reference` command, the `desktop` tests run by default. If you
want to run the mobile visual regression test suite pass the `--group mobile`
flag.

An HTML report of your test results with screenshots will be opened
automatically in a browser on a Mac after the test completes. If you're not on a
Mac, you can manually open the report at `http://localhost:4000`. Additionally,
if you want to save the report to a file path, you can do so with the `--output`
flag:

```sh
pixel test -c <change-id> --output <path-to-report>
```

### Stopping the services

If you want to stop all of Pixel's services, run:

```
pixel stop
```

### Cleanup

Sometimes after making MediaWiki code changes, database changes, or having
issues with the containers you just want to throw away everything and start
Pixel with a clean slate. To do that, run:

```
pixel clean
```

## Development

If you want to change the LocalSettings.php file, add/changes tests, or
contribute code to Pixel, you'll want to clone this repository and instead run
the CLI through [./pixel.js](./pixel.js) file. For example, to run the reference
command make sure you are in the root of this repo's directory and run:

```sh
./pixel.js test -c <change-id>
```

### Configuring MediaWiki

All mediawiki config is in [LocalSettings.php](LocalSettings.php) and can be
changed. For example, maybe you are working on a new feature in the `Vector`
skin that is feature flagged and want to enable it. All changes made in this
file will be automatically reflected in the Docker services without having to
restart them.

### Changing or adding tests

Tests are located in config files at the root directory e.g.
[configDesktop.js](configDesktop.js) and currently follow BackstopJS
conventions. For more info on how to change or add tests, please refer to the
[BackstopJS](https://github.com/garris/BackstopJS) README.

Scenarios for mobile site are defined in configMobile.js.

### Installed extensions and skins

Pixel ships with a number of MediaWiki extensions and skins already installed.
Please reference the [repositories.json](repositories.json) file to see a
list of these.
