import { fileURLToPath } from "node:url";
import { writeBrowserNotices } from "./notices";

const root = fileURLToPath(new URL("../../..", import.meta.url));
console.log(JSON.stringify(writeBrowserNotices(root)));
