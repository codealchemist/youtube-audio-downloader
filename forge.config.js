import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'

export default {
  packagerConfig: {
    name: 'YouTube Audio Downloader',
    executableName: 'yasapp',
    appBundleId: 'com.codealchemist.yasapp',
    appCategoryType: 'public.app-category.music',
    // ffmpeg is an executable, which can't run from inside the asar archive.
    asar: { unpack: '**/node_modules/ffmpeg-static/**' },
    ignore: [
      /^\/(test|e2e|test-results|playwright-report|coverage|out|\.github)(\/|$)/,
      /^\/(vitest|playwright|eslint|forge)\.config\.js$/,
      /^\/\.gitignore$/
    ]
  },
  makers: [
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: { authors: 'codealchemist' } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'win32', 'linux'] },
    { name: '@electron-forge/maker-deb', platforms: ['linux'], config: { options: { maintainer: 'codealchemist', categories: ['AudioVideo'] } } },
    { name: '@electron-forge/maker-rpm', platforms: ['linux'], config: { options: { categories: ['AudioVideo'] } } }
  ],
  plugins: [
    // Turn off Electron features this app never uses, so a packaged copy
    // can't be repurposed (run as plain Node, debugged, or have its code swapped).
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
}
