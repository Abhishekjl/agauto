// Test bundle entry: exposes the real content-script modules to the test page.
import { scanPage } from "../extension/src/content/scan";
import { performAction } from "../extension/src/content/actions";

(window as unknown as Record<string, unknown>).__agauto = { scanPage, performAction };
