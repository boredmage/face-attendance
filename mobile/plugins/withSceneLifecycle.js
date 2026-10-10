/**
 * Adopts the UIScene lifecycle, which iOS 27 requires: apps without a scene manifest are killed
 * at launch (crash in _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
 *
 * Expo SDK 54's AppDelegate (Swift) still builds its window in
 * application(_:didFinishLaunchingWithOptions:), before any scene exists. The SceneDelegate added
 * here simply moves that window onto the scene iOS hands us, so the rest of the app is untouched.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const MARKER = '// [withSceneLifecycle]';

const SCENE_DELEGATE = `

${MARKER} iOS 27 requires the UIScene lifecycle; attach React Native's window to the scene.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let window = appDelegate.window else {
      return
    }
    window.windowScene = windowScene
    self.window = window
    window.makeKeyAndVisible()
    open(connectionOptions.urlContexts)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    open(URLContexts)
  }

  private func open(_ contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }
}
`;

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            // Swift classes are looked up by their module-qualified name
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

function withSceneDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle only supports a Swift AppDelegate (Expo SDK 53+)');
    }
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents = cfg.modResults.contents.trimEnd() + SCENE_DELEGATE;
    }
    return cfg;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneDelegate(withSceneManifest(config));
};
