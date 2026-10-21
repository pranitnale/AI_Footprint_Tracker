// Stand-in for wxt/browser in the visual preview: storage is in memory and navigation only logs.
const memory: Record<string, unknown> = {};
export const browser = {
  runtime: { getURL: (path: string) => path, sendMessage: async () => ({}), getManifest: () => ({ version: "0.1.0" }) },
  storage: {
    local: {
      get: async (key: string) => (key in memory ? { [key]: memory[key] } : {}),
      set: async (items: Record<string, unknown>) => void Object.assign(memory, items),
    },
  },
  tabs: {
    create: async (options: { url: string }) => void console.info("open", options.url),
    query: async () => (new URLSearchParams(location.search).get("tab") ? [{ id: 7, url: `https://${new URLSearchParams(location.search).get("tab")}/c/1` }] : []),
    reload: async () => undefined,
  },
};
