/**
 * Raises every CocoaPods target's IPHONEOS_DEPLOYMENT_TARGET to the app's minimum (15.5).
 *
 * Xcode 27 refuses to build targets below iOS 15, and several ML Kit / Google support pods
 * (GoogleToolboxForMac, GTMSessionFetcher, nanopb, PromisesObjC, ...) still declare 9.0–12.0.
 * Injected into the Podfile's post_install so it survives `expo prebuild`.
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# [withPodsDeploymentTarget]';
const MIN_TARGET = '15.5';

const SNIPPET = `
    ${MARKER} Xcode 27 rejects pod targets below iOS 15
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        current = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || Gem::Version.new(current) < Gem::Version.new('${MIN_TARGET}')
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_TARGET}'
        end
      end
    end
`;

module.exports = function withPodsDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes(MARKER)) {
        contents = contents.replace(/post_install do \|installer\|\n/, (m) => m + SNIPPET);
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
