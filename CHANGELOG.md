# Changelog for Online Dance Party Browser Extension

All notable changes to the browser extension will be documented in this file. Sometimes new features only require changes to the server, so make sure to also check out the [server changelog](https://codeberg.org/ODP/server/src/branch/main/CHANGELOG.md).

## [2.4.2] - 2025-07-20

* Remove option to re-enable disabled songs, does not work anymore.

## [2.4.1] - 2024-08-19

* Updated link to new issue tracker
* Updated link to new instruction video

## [2.4.0] - 2024-08-10

* Show error message when room name already claimed or not available
* Show dance room name in the top left
* Allow host to refresh the page in the middle of a song

## [2.3.0] - 2024-08-07

* Synchronize start of song between users.

## [2.2.2] - 2024-08-06

* Rename code to name to prevent confusion with dance room code.
* Fix disconnecting in the middle of a song after host disconnects.
* Send sync messages to server as follower, required by upcoming server release.

## [2.2.1] - 2024-08-02

* Block annoying unsupported browser popup on Linux.
* Remove permissions unused since using new redirect method.

## [2.2.0] - 2024-08-01

* Improved UI.
* Added dark theme.
* Added option to re-enable disabled songs.

## [2.1.0] - 2024-07-30

* Migrate to manifest V3.

## [2.0.0] - 2024-07-30

* Redirect websocket by overwriting WebSocket constructor, previous method stopped working. Requires at least server v1.3.0.

## [1.2.1] - 2021-05-04 

This version is actually 1.1.0 and was only uploaded to the Chrome Web Store because 1.2.0 does not work on Chrome.

## [1.2.0] - 2021-05-04

Requires at least server v1.2.0.

* Fix `Dance Room does not exist` error for users on the same continent.
* Improved UI: different color for disabled input.
* Added 128x128 icon.

## [1.1.0] - 2021-02-13

* Improved UI.

## [1.0.0] - 2021-02-02

Initial release.
