// Uniwind compiles global.css (Tailwind v4 + HeroUI Native styles) at bundle time.
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);
// The on-device face model (assets/models/facenet512.tflite) is bundled as an asset
config.resolver.assetExts.push('tflite');

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
});
