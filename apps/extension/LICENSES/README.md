# Shipped WXT runtime notices

The production `content.js` includes WXT's `ContentScriptContext`, custom events, location watcher and lifecycle helpers. `wxt/utils/define-content-script` and `wxt/utils/define-background` are also runtime entry imports. `wxt/browser` re-exports `@wxt-dev/browser`, whose six-line runtime selects the available extension API. These need notices even though WXT is declared as a development dependency.

- WXT 0.21.4: official tag `wxt-v0.21.4`, commit `8fea9b4837282f4ad2a0d085ced6bee1a7de08fb`; [full upstream license](https://github.com/wxt-dev/wxt/blob/8fea9b4837282f4ad2a0d085ced6bee1a7de08fb/LICENSE) preserved as `wxt-MIT.txt`.
- `@wxt-dev/browser` 0.1.43: official repository commit `22b7aba035c59f347e56ffc1b8ca26b6d9fb3808`, whose `packages/browser/package.json` declares that exact version; [full upstream license](https://github.com/wxt-dev/wxt/blob/22b7aba035c59f347e56ffc1b8ca26b6d9fb3808/LICENSE) preserved as `wxt-browser-MIT.txt`. The installed runtime `src/index.mjs` was compared with that commit and matched on 10 September 2026.

The npm archives omit standalone license files. `build/notices.ts` therefore uses these preserved, version-checked originals. Their bytes and hashes enter the built notice inventory.

The inspected runtime chain is WXT's isolated-world virtual entrypoint → `content-script-context.mjs` → internal custom-events/location-watcher/logger modules → `wxt/browser` → `@wxt-dev/browser`. Background `MatchPattern` is used only by the development-server branch and is removed from the production bundle. WXT build utilities, React refresh tooling and `@wxt-dev/browser`'s `@types/*` dependencies are not marked as shipped runtime components. Revisit this explicit runtime subset if imports or WXT versions change.

Vite is the exception among the build tools. The released chunks contain its dynamic-import preload helper (the strings "Unable to preload CSS" and "vite:preloadError" were found in the Chrome package of 18 October 2026). `build/notices.ts` therefore records WXT's Vite as a shipped component and copies its full upstream `LICENSE.md`, which also carries the licences of the code Vite bundles.
