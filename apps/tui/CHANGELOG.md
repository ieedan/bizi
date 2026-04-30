# Changelog

## [0.7.0](https://github.com/ieedan/bizi/compare/tui-v0.6.0...tui-v0.7.0) (2026-04-30)


### Features

* **tui:** copy log selection to clipboard with Ctrl+C ([#43](https://github.com/ieedan/bizi/issues/43)) ([634b934](https://github.com/ieedan/bizi/commit/634b9342928b0e5151cfb05ad5984e9e97b01d1d))

## [0.6.0](https://github.com/ieedan/bizi/compare/tui-v0.5.1...tui-v0.6.0) (2026-04-16)


### Features

* **tui:** display tasks in task.config.json order ([4b806c8](https://github.com/ieedan/bizi/commit/4b806c81e84b870fc901db92a6b7f9df6521f5df))

## [0.5.1](https://github.com/ieedan/bizi/compare/tui-v0.5.0...tui-v0.5.1) (2026-03-10)


### Bug Fixes

* **tui:** Ensure to exit process when quitting the tui ([c32c239](https://github.com/ieedan/bizi/commit/c32c239901c0516e1c1013efd3a76a701d534e6a))

## [0.5.0](https://github.com/ieedan/bizi/compare/tui-v0.4.0...tui-v0.5.0) (2026-02-27)


### Features

* **tui:** Add `init` command for easy package.json migration ([9485559](https://github.com/ieedan/bizi/commit/948555903c10f6955378a873d0cb33f822becf82))

## [0.4.0](https://github.com/ieedan/bizi/compare/tui-v0.3.2...tui-v0.4.0) (2026-02-26)


### Features

* **tui:** Virtualize logs in run details panel ([#37](https://github.com/ieedan/bizi/issues/37)) ([aea8cbe](https://github.com/ieedan/bizi/commit/aea8cbe2df77654fbd0215e87349d48bc70cdb64))

## [0.3.2](https://github.com/ieedan/bizi/compare/tui-v0.3.1...tui-v0.3.2) (2026-02-23)


### Bug Fixes

* **tui:** show correct state in footer ([7374cb8](https://github.com/ieedan/bizi/commit/7374cb8827fb13c110906d73751a58be37732300))

## [0.3.1](https://github.com/ieedan/bizi/compare/tui-v0.3.0...tui-v0.3.1) (2026-02-23)


### Bug Fixes

* **server:** Ensure commands can be found on macos installation ([b5dfceb](https://github.com/ieedan/bizi/commit/b5dfceb35208436f2ef65e2620ab497097abc432))

## [0.3.0](https://github.com/ieedan/bizi/compare/tui-v0.2.6...tui-v0.3.0) (2026-02-19)


### Features

* **tui:** render ANSI-styled task logs in run details ([f936d15](https://github.com/ieedan/bizi/commit/f936d1562a421979d286eadd4356e6931daf20e8))

## [0.2.6](https://github.com/ieedan/bizi/compare/tui-v0.2.5...tui-v0.2.6) (2026-02-16)


### Bug Fixes

* **tui:** Ensure CLI doesn't exit `run <task>` if tasks aren't done ([#17](https://github.com/ieedan/bizi/issues/17)) ([88c2a5f](https://github.com/ieedan/bizi/commit/88c2a5fb1e9688de902cef79016c0e8ca1d748f9))

## [0.2.5](https://github.com/ieedan/bizi/compare/tui-v0.2.4...tui-v0.2.5) (2026-02-16)


### Bug Fixes

* **tui:** fix publish ([17d526a](https://github.com/ieedan/bizi/commit/17d526ab7004bf978f32ba82e0a3d6008f9a836f))

## [0.2.4](https://github.com/ieedan/bizi/compare/tui-v0.2.3...tui-v0.2.4) (2026-02-16)


### Bug Fixes

* **tui:** fix build script ([03df750](https://github.com/ieedan/bizi/commit/03df750b99232da34aaec40df5b22d873be972d2))

## [0.2.3](https://github.com/ieedan/bizi/compare/tui-v0.2.2...tui-v0.2.3) (2026-02-16)


### Bug Fixes

* **tui:** fix build ([50f7dc0](https://github.com/ieedan/bizi/commit/50f7dc0bc0d04ee2414f18a03d91342fde5bde1c))

## [0.2.2](https://github.com/ieedan/bizi/compare/tui-v0.2.1...tui-v0.2.2) (2026-02-16)


### Bug Fixes

* **tui:** repair pnpm lock ([ce27ab9](https://github.com/ieedan/bizi/commit/ce27ab9d81540b5f83ae6776ea4d2b31a0b3edde))

## [0.2.1](https://github.com/ieedan/bizi/compare/tui-v0.2.0...tui-v0.2.1) (2026-02-16)


### Bug Fixes

* **tui:** formatting ([6650335](https://github.com/ieedan/bizi/commit/665033552b4a28ab8421d7b1d5123b750501c05a))

## [0.1.0](https://github.com/ieedan/bizi/compare/tui-v0.0.3...tui-v0.1.0) (2026-02-16)


### Features

* add cli commands to tui ([#4](https://github.com/ieedan/bizi/issues/4)) ([700f92d](https://github.com/ieedan/bizi/commit/700f92dac39404e64a9bbf373791d81e1f30b910))
* show dialog to cancel running tasks before exiting ([#3](https://github.com/ieedan/bizi/issues/3)) ([0e63df4](https://github.com/ieedan/bizi/commit/0e63df45454cac5e01affac24e0e72de4dc369fa))
* trigger release for all packages ([cbe8c25](https://github.com/ieedan/bizi/commit/cbe8c2590a5984c9672e14d134abd723cb07696d))
* tui ([#1](https://github.com/ieedan/bizi/issues/1)) ([8ccd8f6](https://github.com/ieedan/bizi/commit/8ccd8f6f0b8c8f174f357537a47554381e1dad72))


### Bug Fixes

* **client:** rename createTaskRunnerApi -&gt; createBiziApi ([2c35f91](https://github.com/ieedan/bizi/commit/2c35f9169f9e4b7ec345da286c291bd0c122d58c))
* **tui:** improve / run handling ([4d733df](https://github.com/ieedan/bizi/commit/4d733df34f184b4554a33e2b0829459b4a58a0bf))

## [0.2.0](https://github.com/ieedan/bizi/compare/tui-v0.1.0...tui-v0.2.0) (2026-02-16)


### Features

* add cli commands to tui ([#4](https://github.com/ieedan/bizi/issues/4)) ([700f92d](https://github.com/ieedan/bizi/commit/700f92dac39404e64a9bbf373791d81e1f30b910))
* show dialog to cancel running tasks before exiting ([#3](https://github.com/ieedan/bizi/issues/3)) ([0e63df4](https://github.com/ieedan/bizi/commit/0e63df45454cac5e01affac24e0e72de4dc369fa))
* trigger release for all packages ([cbe8c25](https://github.com/ieedan/bizi/commit/cbe8c2590a5984c9672e14d134abd723cb07696d))
* tui ([#1](https://github.com/ieedan/bizi/issues/1)) ([8ccd8f6](https://github.com/ieedan/bizi/commit/8ccd8f6f0b8c8f174f357537a47554381e1dad72))


### Bug Fixes

* **client:** rename createTaskRunnerApi -&gt; createBiziApi ([2c35f91](https://github.com/ieedan/bizi/commit/2c35f9169f9e4b7ec345da286c291bd0c122d58c))
* **tui:** improve / run handling ([4d733df](https://github.com/ieedan/bizi/commit/4d733df34f184b4554a33e2b0829459b4a58a0bf))

## [0.1.0](https://github.com/ieedan/bizi/compare/tui-v0.0.3...tui-v0.1.0) (2026-02-16)


### Features

* add cli commands to tui ([#4](https://github.com/ieedan/bizi/issues/4)) ([700f92d](https://github.com/ieedan/bizi/commit/700f92dac39404e64a9bbf373791d81e1f30b910))
* show dialog to cancel running tasks before exiting ([#3](https://github.com/ieedan/bizi/issues/3)) ([0e63df4](https://github.com/ieedan/bizi/commit/0e63df45454cac5e01affac24e0e72de4dc369fa))
* trigger release for all packages ([cbe8c25](https://github.com/ieedan/bizi/commit/cbe8c2590a5984c9672e14d134abd723cb07696d))
* tui ([#1](https://github.com/ieedan/bizi/issues/1)) ([8ccd8f6](https://github.com/ieedan/bizi/commit/8ccd8f6f0b8c8f174f357537a47554381e1dad72))


### Bug Fixes

* **client:** rename createTaskRunnerApi -&gt; createBiziApi ([2c35f91](https://github.com/ieedan/bizi/commit/2c35f9169f9e4b7ec345da286c291bd0c122d58c))
* **tui:** improve / run handling ([4d733df](https://github.com/ieedan/bizi/commit/4d733df34f184b4554a33e2b0829459b4a58a0bf))

## [0.2.0](https://github.com/ieedan/bizi/compare/tui-v0.1.0...tui-v0.2.0) (2026-02-16)


### Features

* trigger release for all packages ([cbe8c25](https://github.com/ieedan/bizi/commit/cbe8c2590a5984c9672e14d134abd723cb07696d))

## [0.1.0](https://github.com/ieedan/bizi/compare/tui-v0.0.3...tui-v0.1.0) (2026-02-16)


### Features

* add cli commands to tui ([#4](https://github.com/ieedan/bizi/issues/4)) ([700f92d](https://github.com/ieedan/bizi/commit/700f92dac39404e64a9bbf373791d81e1f30b910))
* show dialog to cancel running tasks before exiting ([#3](https://github.com/ieedan/bizi/issues/3)) ([0e63df4](https://github.com/ieedan/bizi/commit/0e63df45454cac5e01affac24e0e72de4dc369fa))
* tui ([#1](https://github.com/ieedan/bizi/issues/1)) ([8ccd8f6](https://github.com/ieedan/bizi/commit/8ccd8f6f0b8c8f174f357537a47554381e1dad72))


### Bug Fixes

* **client:** rename createTaskRunnerApi -&gt; createBiziApi ([2c35f91](https://github.com/ieedan/bizi/commit/2c35f9169f9e4b7ec345da286c291bd0c122d58c))
* **tui:** improve / run handling ([4d733df](https://github.com/ieedan/bizi/commit/4d733df34f184b4554a33e2b0829459b4a58a0bf))
