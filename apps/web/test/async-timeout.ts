import { configure } from "@testing-library/react";

// The default 1 s wait for a rendered element failed on a busy test runner while the page was
// still rendering (15 October 2026). A real failure still fails, only after 5 s.
configure({ asyncUtilTimeout: 5000 });
