import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { BrowserController } from "../browser/index.js";
import { logger } from "../utils/index.js";

/**
 * Browser Tools
 * Web browsing actions for the agent.
 * Keep tool outputs concise. The agent only needs enough info to plan next actions.
 */

export function createBrowserTools(browserController: BrowserController) {
  const gotoTool = tool(
    async ({ url }: { url: string }) => {
      logger.browser(`Navigating to: ${url}`);
      const page = await browserController.ensure();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const title = await page.title();
      logger.browser(`Page loaded: "${title}"`);
      
      // Wait a moment for popups to appear
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return `Navigated to ${url}. Title: ${title}. Check for popups using browser_check_popups if needed.`;
    },
    {
      name: "browser_goto",
      description: "Navigate the browser to a URL. After navigation, you should check for popups (cookies, terms, etc.) using browser_check_popups and handle them if present.",
      schema: z.object({
        url: z.string().url(),
      }),
    }
  );

  const clickTool = tool(
    async ({ selector }: { selector: string }) => {
      logger.browser(`Attempting to click: ${selector}`);
      const page = await browserController.ensure();
      
      try {
        // Wait for the element to be visible and clickable
        await page.waitForSelector(selector, { state: "visible", timeout: 10000 });
        
        // Check if element exists and is visible
        const element = await page.$(selector);
        if (!element) {
          const error = `Element not found: ${selector}`;
          logger.browser(`✗ ${error}`);
          return `ERROR: ${error}. Use browser_find_links or browser_find_by_text to find the correct selector.`;
        }

        // Check if element is visible
        const isVisible = await element.isVisible();
        if (!isVisible) {
          const error = `Element exists but is not visible: ${selector}`;
          logger.browser(`✗ ${error}`);
          return `ERROR: ${error}. The element might be hidden or require scrolling.`;
        }

        // Try to click
        await page.click(selector, { timeout: 15000 });
        logger.browser(`✓ Successfully clicked: ${selector}`);
        
        // Wait a bit for page to respond
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return `Successfully clicked: ${selector}`;
      } catch (e: any) {
        const errorMsg = e?.message ?? String(e);
        logger.browser(`✗ Click failed: ${errorMsg}`);
        return `ERROR clicking ${selector}: ${errorMsg}. Try using browser_find_by_text to find the element by its text content, or browser_find_links to see all clickable links.`;
      }
    },
    {
      name: "browser_click",
      description: "Left click an element using a CSS selector. The element must be visible and clickable. If the selector doesn't work, use browser_find_by_text or browser_find_links first.",
      schema: z.object({
        selector: z.string(),
      }),
    }
  );

  const rightClickTool = tool(
    async ({ selector }: { selector: string }) => {
      logger.browser(`Right-clicking: ${selector}`);
      const page = await browserController.ensure();
      await page.click(selector, { button: "right", timeout: 15000 });
      logger.browser(`✓ Right-clicked: ${selector}`);
      return `Right-clicked selector: ${selector}`;
    },
    {
      name: "browser_right_click",
      description: "Right click an element using a CSS selector.",
      schema: z.object({
        selector: z.string(),
      }),
    }
  );

  const typeTool = tool(
    async ({ selector, text, pressEnter }: { selector: string; text: string; pressEnter?: boolean }) => {
      logger.browser(`Typing into ${selector}: "${text}"${pressEnter ? " (will press Enter)" : ""}`);
      const page = await browserController.ensure();
      await page.fill(selector, text, { timeout: 15000 });
      if (pressEnter) await page.press(selector, "Enter");
      logger.browser(`✓ Typed into ${selector}`);
      return `Typed into ${selector}: "${text}"${pressEnter ? " and pressed Enter" : ""}`;
    },
    {
      name: "browser_type",
      description: "Type into an input/textarea using a CSS selector. Optionally press Enter.",
      schema: z.object({
        selector: z.string(),
        text: z.string(),
        pressEnter: z.boolean().optional(),
      }),
    }
  );

  const scrollTool = tool(
    async ({ dy }: { dy: number }) => {
      logger.browser(`Scrolling ${dy > 0 ? "down" : "up"} by ${Math.abs(dy)}px`);
      const page = await browserController.ensure();
      await page.mouse.wheel(0, dy);
      return `Scrolled vertically by dy=${dy}`;
    },
    {
      name: "browser_scroll",
      description: "Scroll the page vertically by dy pixels (positive = down, negative = up).",
      schema: z.object({
        dy: z.number(),
      }),
    }
  );

  const screenshotTool = tool(
    async ({ path }: { path: string }) => {
      logger.browser(`Taking screenshot: ${path}`);
      const page = await browserController.ensure();
      await page.screenshot({ path, fullPage: true });
      logger.browser(`✓ Screenshot saved: ${path}`);
      return `Saved screenshot to ${path}`;
    },
    {
      name: "browser_screenshot",
      description: "Take a full-page screenshot and save it to a file path.",
      schema: z.object({
        path: z.string(),
      }),
    }
  );

  const extractTextTool = tool(
    async ({ selector, maxChars }: { selector: string; maxChars?: number }) => {
      logger.browser(`Extracting text from: ${selector}`);
      const page = await browserController.ensure();
      const el = await page.$(selector);
      if (!el) {
        logger.browser(`✗ Element not found: ${selector}`);
        return `No element found for selector: ${selector}`;
      }
      const text = (await el.innerText()).trim();
      // Default to 5000 chars to get more content for analysis
      const defaultMax = 5000;
      const clipped = typeof maxChars === "number" ? text.slice(0, maxChars) : text.slice(0, defaultMax);
      logger.browser(`✓ Extracted ${clipped.length} characters from ${selector}`);
      return `Extracted text (${clipped.length} chars) from ${selector}:\n${clipped}`;
    },
    {
      name: "browser_extract_text",
      description: "Extract innerText from a CSS selector. Use this to read article content, headlines, or any text on the page. Default extracts up to 5000 characters. Use 'body' or 'main' selector to get all page content.",
      schema: z.object({
        selector: z.string(),
        maxChars: z.number().optional(),
      }),
    }
  );

  const findByTextTool = tool(
    async ({ text, exact }: { text: string; exact?: boolean }) => {
      logger.browser(`Finding elements containing text: "${text}"`);
      const page = await browserController.ensure();
      
      try {
        // Use Playwright's getByText or locator with text
        let elements;
        if (exact) {
          elements = await page.locator(`text="${text}"`).all();
        } else {
          // Find all elements and filter by text content
          elements = await page.locator(`text=/.*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*/i`).all();
        }
        
        if (elements.length === 0) {
          logger.browser(`✗ No elements found with text: "${text}"`);
          return `No elements found containing text: "${text}". Try using browser_find_links to see all clickable elements.`;
        }

        const results = [];
        for (let i = 0; i < Math.min(elements.length, 10); i++) {
          const el = elements[i];
          try {
            const tagName = await el.evaluate((el: any) => el.tagName.toLowerCase());
            const isVisible = await el.isVisible();
            const href = tagName === "a" ? (await el.getAttribute("href")) : null;
            const innerText = (await el.innerText()).trim().substring(0, 100);
            
            // Try to get a better selector
            let betterSelector = `text="${text}"`;
            try {
              const id = await el.getAttribute("id");
              if (id) betterSelector = `#${id}`;
              else {
                const className = await el.getAttribute("class");
                if (className) {
                  const firstClass = className.split(" ")[0];
                  betterSelector = `${tagName}.${firstClass}`;
                } else {
                  betterSelector = `${tagName}:has-text("${text}")`;
                }
              }
            } catch {}

            results.push({
              index: i + 1,
              tag: tagName,
              visible: isVisible,
              selector: betterSelector,
              text: innerText,
              href: href,
            });
          } catch (e) {
            // Skip elements that can't be evaluated
            continue;
          }
        }

        if (results.length === 0) {
          logger.browser(`✗ Found elements but couldn't extract info`);
          return `Found ${elements.length} element(s) but couldn't extract details. Try using browser_find_links instead.`;
        }

        logger.browser(`✓ Found ${results.length} element(s) with text "${text}"`);
        const resultStr = `Found ${results.length} element(s) containing "${text}":\n${JSON.stringify(results, null, 2)}`;
        return resultStr;
      } catch (e: any) {
        const errorMsg = e?.message ?? String(e);
        logger.browser(`✗ Error finding by text: ${errorMsg}`);
        return `ERROR: ${errorMsg}. Try using browser_find_links to see all clickable elements.`;
      }
    },
    {
      name: "browser_find_by_text",
      description: "Find clickable elements by their text content. Returns selectors you can use with browser_click. Use this when you know the text but not the selector.",
      schema: z.object({
        text: z.string(),
        exact: z.boolean().optional(),
      }),
    }
  );

  const findLinksTool = tool(
    async ({ maxLinks }: { maxLinks?: number }) => {
      logger.browser("Finding all clickable links on the page");
      const page = await browserController.ensure();
      
      try {
        const links = await page.$$eval("a, button, [onclick], [role='button']", (elements) => {
          return elements.slice(0, 50).map((el, i) => {
            const tag = el.tagName.toLowerCase();
            const text = el.textContent?.trim().substring(0, 100) || "";
            const href = (el as any).href || "";
            const id = el.id || "";
            const className = el.className?.toString().split(" ")[0] || "";
            
            let selector = tag;
            if (id) selector = `#${id}`;
            else if (className) selector = `${tag}.${className}`;
            
            return {
              index: i + 1,
              tag,
              text,
              href: href || null,
              selector,
            };
          });
        });

        const limit = maxLinks || 20;
        const limitedLinks = links.slice(0, limit);
        
        logger.browser(`✓ Found ${links.length} clickable element(s), showing first ${limitedLinks.length}`);
        return `Found ${links.length} clickable elements:\n${JSON.stringify(limitedLinks, null, 2)}`;
      } catch (e: any) {
        const errorMsg = e?.message ?? String(e);
        logger.browser(`✗ Error finding links: ${errorMsg}`);
        return `ERROR: ${errorMsg}`;
      }
    },
    {
      name: "browser_find_links",
      description: "Find all clickable links, buttons, and interactive elements on the page. Returns their text, href, and selectors. Use this to discover what's clickable on the page. Essential for exploring websites - use this to find navigation menus, article links, etc.",
      schema: z.object({
        maxLinks: z.number().optional(),
      }),
    }
  );

  const extractMultipleTool = tool(
    async ({ selector, maxItems }: { selector: string; maxItems?: number }) => {
      logger.browser(`Extracting multiple items from: ${selector}`);
      const page = await browserController.ensure();
      
      try {
        const elements = await page.$$(selector);
        const limit = maxItems || 10;
        const items = [];

        for (let i = 0; i < Math.min(elements.length, limit); i++) {
          const el = elements[i];
          try {
            const text = (await el.innerText()).trim();
            const href = await el.getAttribute("href");
            const tagName = await el.evaluate((el: any) => el.tagName.toLowerCase());
            
            items.push({
              index: i + 1,
              tag: tagName,
              text: text.substring(0, 500), // Limit text length
              href: href || null,
            });
          } catch (e) {
            // Skip elements that can't be read
            continue;
          }
        }

        logger.browser(`✓ Extracted ${items.length} items from ${selector}`);
        return `Found ${elements.length} elements, extracted ${items.length} items:\n${JSON.stringify(items, null, 2)}`;
      } catch (e: any) {
        const errorMsg = e?.message ?? String(e);
        logger.browser(`✗ Error extracting multiple items: ${errorMsg}`);
        return `ERROR: ${errorMsg}`;
      }
    },
    {
      name: "browser_extract_multiple",
      description: "Extract multiple elements matching a selector (e.g., all article links, all headlines). Useful for news sites where you need to see multiple items. Returns an array of items with their text and href.",
      schema: z.object({
        selector: z.string(),
        maxItems: z.number().optional(),
      }),
    }
  );

  const checkPopupsTool = tool(
    async () => {
      logger.browser("Checking for popups, modals, or overlays");
      const page = await browserController.ensure();
      
      try {
        // Common selectors for popups, cookie banners, terms, etc.
        const popupSelectors = [
          // Cookie/Privacy popups
          '[id*="cookie"]', '[class*="cookie"]', '[id*="Cookie"]', '[class*="Cookie"]',
          '[id*="privacy"]', '[class*="privacy"]', '[id*="Privacy"]', '[class*="Privacy"]',
          '[id*="consent"]', '[class*="consent"]', '[id*="Consent"]', '[class*="Consent"]',
          // Terms and conditions
          '[id*="terms"]', '[class*="terms"]', '[id*="Terms"]', '[class*="Terms"]',
          '[id*="accept"]', '[class*="accept"]', '[id*="Accept"]', '[class*="Accept"]',
          // Common button texts
          'button:has-text("Accept")', 'button:has-text("I Accept")', 'button:has-text("Agree")',
          'button:has-text("Continue")', 'button:has-text("OK")', 'button:has-text("Got it")',
          'a:has-text("Accept")', 'a:has-text("Continue")', 'a:has-text("I Agree")',
          // Modal overlays
          '[role="dialog"]', '.modal', '#modal', '[class*="modal"]',
          // Close buttons
          'button[aria-label*="close" i]', 'button[aria-label*="Close" i]',
          '.close', '[class*="close"]', '[id*="close"]',
        ];

        const foundPopups = [];
        
        for (const selector of popupSelectors) {
          try {
            const elements = await page.$$(selector);
            for (const el of elements) {
              const isVisible = await el.isVisible();
              if (isVisible) {
                const tagName = await el.evaluate((el: any) => el.tagName.toLowerCase());
                const text = (await el.innerText()).trim().substring(0, 100);
                const id = await el.getAttribute("id");
                const className = await el.getAttribute("class");
                
                // Try to find a button to click
                let clickableSelector = selector;
                if (id) clickableSelector = `#${id}`;
                else if (className) {
                  const firstClass = className.split(" ")[0];
                  clickableSelector = `${tagName}.${firstClass}`;
                }
                
                foundPopups.push({
                  selector: clickableSelector,
                  tag: tagName,
                  text: text,
                  type: selector.includes("cookie") || selector.includes("Cookie") ? "cookie" :
                        selector.includes("terms") || selector.includes("Terms") ? "terms" :
                        selector.includes("accept") || selector.includes("Accept") ? "accept" :
                        "popup"
                });
              }
            }
          } catch (e) {
            // Continue if selector fails
            continue;
          }
        }

        if (foundPopups.length === 0) {
          logger.browser("✓ No popups detected");
          return "No popups, modals, or overlays detected on the page.";
        }

        logger.browser(`Found ${foundPopups.length} popup(s)`);
        const result = `Found ${foundPopups.length} popup/modal(s):\n${JSON.stringify(foundPopups, null, 2)}\n\nUse browser_click with one of the selectors to dismiss the popup. Look for buttons with text like "Accept", "Continue", "I Agree", or "OK".`;
        return result;
      } catch (e: any) {
        const errorMsg = e?.message ?? String(e);
        logger.browser(`✗ Error checking popups: ${errorMsg}`);
        return `ERROR: ${errorMsg}`;
      }
    },
    {
      name: "browser_check_popups",
      description: "Check for popups, modals, cookie banners, terms dialogs, or other overlays on the current page. Returns selectors you can use to dismiss them. ALWAYS call this after navigating to a new page, especially news sites.",
      schema: z.object({}),
    }
  );

  const analyzePageTool = tool(
    async ({ whatToLookFor }: { whatToLookFor?: string }) => {
      logger.browser(`Analyzing current page${whatToLookFor ? ` for: ${whatToLookFor}` : ""}`);
      const page = await browserController.ensure();
      
      try {
        // Get page title and URL
        const title = await page.title();
        const url = page.url();
        
        // Extract main content
        const bodyText = await page.evaluate(() => {
          const body = (globalThis as any).document?.body;
          return body ? body.innerText.substring(0, 3000) : "";
        });
        
        // Find all links
        const links = await page.$$eval("a", (anchors: any[]) => {
          return anchors.slice(0, 20).map((a: any, i: number) => ({
            index: i + 1,
            text: a.innerText.trim().substring(0, 100),
            href: a.href,
          }));
        });
        
        // Find all buttons
        const buttons = await page.$$eval("button, [role='button']", (buttons: any[]) => {
          return buttons.slice(0, 15).map((b: any, i: number) => ({
            index: i + 1,
            text: b.innerText.trim().substring(0, 100),
            type: b.type,
          }));
        });
        
        // Find headings
        const headings = await page.$$eval("h1, h2, h3", (headings: any[]) => {
          return headings.slice(0, 10).map((h: any, i: number) => ({
            index: i + 1,
            level: h.tagName,
            text: h.innerText.trim().substring(0, 200),
          }));
        });
        
        logger.browser(`✓ Page analyzed: ${title}`);
        
        const analysis = {
          url,
          title,
          contentPreview: bodyText.substring(0, 500),
          links: links.length,
          buttons: buttons.length,
          headings: headings.length,
          topLinks: links.slice(0, 5),
          topButtons: buttons.slice(0, 5),
          topHeadings: headings.slice(0, 5),
        };
        
        return `Page Analysis:\n${JSON.stringify(analysis, null, 2)}\n\nUse this information to understand the page structure and decide what to click or extract next.`;
      } catch (e: any) {
        const errorMsg = e?.message ?? String(e);
        logger.browser(`✗ Error analyzing page: ${errorMsg}`);
        return `ERROR: ${errorMsg}`;
      }
    },
    {
      name: "browser_analyze_page",
      description: "Analyze the current page structure. Returns page title, URL, links, buttons, headings, and content preview. Use this to understand what's on the page and decide your next actions. Call this after navigating to understand the page layout.",
      schema: z.object({
        whatToLookFor: z.string().optional(),
      }),
    }
  );

  const getUrlTool = tool(
    async () => {
      const page = await browserController.ensure();
      const url = page.url();
      const title = await page.title();
      logger.browser(`Current page: ${url}`);
      return `Current URL: ${url}\nTitle: ${title}`;
    },
    {
      name: "browser_get_url",
      description: "Get the current page URL and title. Use when you need to confirm where you are or report the page to the user.",
      schema: z.object({}),
    }
  );

  const backTool = tool(
    async () => {
      logger.browser("Going back");
      const page = await browserController.ensure();
      await page.goBack();
      const url = page.url();
      const title = await page.title();
      logger.browser(`✓ Back to: ${url}`);
      return `Navigated back. Now at: ${url} (${title})`;
    },
    {
      name: "browser_back",
      description: "Go back to the previous page in browser history. Use after opening an article to return to the list, or to undo a navigation.",
      schema: z.object({}),
    }
  );

  const waitTool = tool(
    async ({ seconds, selector }: { seconds?: number; selector?: string }) => {
      const page = await browserController.ensure();
      if (selector) {
        logger.browser(`Waiting for selector: ${selector}`);
        await page.waitForSelector(selector, { state: "visible", timeout: (seconds || 10) * 1000 });
        logger.browser(`✓ Selector appeared`);
        return `Element "${selector}" is now visible.`;
      }
      const secs = seconds ?? 2;
      logger.browser(`Waiting ${secs} second(s)`);
      await new Promise((r) => setTimeout(r, secs * 1000));
      return `Waited ${secs} second(s).`;
    },
    {
      name: "browser_wait",
      description: "Wait for an element to appear (by selector) or wait a number of seconds. Use when the page loads content dynamically (e.g. after scroll or after a click).",
      schema: z.object({
        seconds: z.number().optional(),
        selector: z.string().optional(),
      }),
    }
  );

  const hoverTool = tool(
    async ({ selector }: { selector: string }) => {
      logger.browser(`Hovering over: ${selector}`);
      const page = await browserController.ensure();
      await page.hover(selector, { timeout: 10000 });
      logger.browser(`✓ Hovered`);
      return `Hovered over ${selector}. Use browser_find_links or browser_click to interact with revealed menu items.`;
    },
    {
      name: "browser_hover",
      description: "Hover over an element. Use for dropdown menus that only appear on hover (e.g. navigation menus). After hovering, use browser_find_links to see the menu options.",
      schema: z.object({
        selector: z.string(),
      }),
    }
  );

  const pressKeyTool = tool(
    async ({ key }: { key: string }) => {
      logger.browser(`Pressing key: ${key}`);
      const page = await browserController.ensure();
      await page.keyboard.press(key);
      logger.browser(`✓ Key pressed`);
      return `Pressed key: ${key}`;
    },
    {
      name: "browser_press_key",
      description: "Press a keyboard key. Common keys: Escape (close modals), Enter (submit), Tab (next field), ArrowDown/ArrowUp (scroll or select). Use Escape to dismiss popups or overlays.",
      schema: z.object({
        key: z.string(),
      }),
    }
  );

  const refreshTool = tool(
    async () => {
      logger.browser("Refreshing page");
      const page = await browserController.ensure();
      await page.reload({ waitUntil: "domcontentloaded" });
      const title = await page.title();
      logger.browser(`✓ Reloaded: ${title}`);
      return `Page refreshed. Title: ${title}. Check for popups if needed.`;
    },
    {
      name: "browser_refresh",
      description: "Refresh/reload the current page. Use when the page failed to load correctly or content is stale.",
      schema: z.object({}),
    }
  );

  const selectOptionTool = tool(
    async ({ selector, value, label }: { selector: string; value?: string; label?: string }) => {
      logger.browser(`Selecting option in ${selector}`);
      const page = await browserController.ensure();
      if (value) {
        await page.selectOption(selector, value, { timeout: 10000 });
      } else if (label) {
        await page.selectOption(selector, { label }, { timeout: 10000 });
      } else {
        return "ERROR: Provide either value or label for the option to select.";
      }
      logger.browser(`✓ Selected`);
      return `Selected option in ${selector}.`;
    },
    {
      name: "browser_select_option",
      description: "Select an option in a dropdown (select element). Use value (option value attribute) or label (visible text).",
      schema: z.object({
        selector: z.string(),
        value: z.string().optional(),
        label: z.string().optional(),
      }),
    }
  );

  const checkCheckboxTool = tool(
    async ({ selector, check }: { selector: string; check: boolean }) => {
      logger.browser(`${check ? "Checking" : "Unchecking"} ${selector}`);
      const page = await browserController.ensure();
      if (check) {
        await page.check(selector, { timeout: 10000 });
      } else {
        await page.uncheck(selector, { timeout: 10000 });
      }
      logger.browser(`✓ Done`);
      return `${check ? "Checked" : "Unchecked"} ${selector}.`;
    },
    {
      name: "browser_checkbox",
      description: "Check or uncheck a checkbox or radio. Use check: true to check, check: false to uncheck.",
      schema: z.object({
        selector: z.string(),
        check: z.boolean(),
      }),
    }
  );

  const uploadFileTool = tool(
    async ({ selector, path }: { selector: string; path: string }) => {
      logger.browser(`Uploading file to ${selector}: ${path}`);
      const page = await browserController.ensure();
      await page.setInputFiles(selector, path, { timeout: 10000 });
      logger.browser(`✓ File set`);
      return `Set file input ${selector} to ${path}.`;
    },
    {
      name: "browser_upload_file",
      description: "Set a file on an input type=file. path must be an absolute path to a file on the machine running the browser.",
      schema: z.object({
        selector: z.string(),
        path: z.string(),
      }),
    }
  );

  const searchGoogleTool = tool(
    async ({ query }: { query: string }) => {
      logger.browser(`Searching Google for: ${query}`);
      const page = await browserController.ensure();
      const encoded = encodeURIComponent(query);
      await page.goto(`https://www.google.com/search?q=${encoded}`, { waitUntil: "domcontentloaded" });
      const title = await page.title();
      logger.browser(`✓ Search results loaded`);
      return `Opened Google search for "${query}". Title: ${title}. Use browser_check_popups, then browser_analyze_page or browser_extract_text to get results.`;
    },
    {
      name: "browser_search_google",
      description: "Open Google and run a search query. Use when the user wants to search the web. Then extract or analyze the results page.",
      schema: z.object({
        query: z.string(),
      }),
    }
  );

  const fillAndSubmitSearchTool = tool(
    async ({ selector, query, submitSelector }: { selector: string; query: string; submitSelector?: string }) => {
      logger.browser(`Filling search: ${selector} with "${query}"`);
      const page = await browserController.ensure();
      await page.fill(selector, query, { timeout: 10000 });
      if (submitSelector) {
        await page.click(submitSelector, { timeout: 5000 });
      } else {
        await page.press(selector, "Enter");
      }
      await new Promise((r) => setTimeout(r, 2000));
      const url = page.url();
      logger.browser(`✓ Search submitted`);
      return `Submitted search. Current URL: ${url}. Use browser_analyze_page or browser_extract_text to get results.`;
    },
    {
      name: "browser_fill_and_submit_search",
      description: "Type into a search box and submit (Enter or click submit button). Use when the page has a search field. submitSelector is optional; if omitted, Enter is pressed in the field.",
      schema: z.object({
        selector: z.string(),
        query: z.string(),
        submitSelector: z.string().optional(),
      }),
    }
  );

  const listFramesTool = tool(
    async () => {
      logger.browser("Listing frames");
      const page = await browserController.ensure();
      const frames = page.frames();
      const info = frames.map((f, i) => ({
        index: i,
        url: f.url(),
        name: f.name() || null,
      }));
      logger.browser(`Found ${frames.length} frame(s)`);
      return `Frames: ${JSON.stringify(info, null, 2)}. Use browser_frame_click or browser_frame_extract_text with the frame index to interact inside an iframe.`;
    },
    {
      name: "browser_list_frames",
      description: "List all iframes on the current page. Use browser_frame_click or browser_frame_extract_text with the frame index to interact inside an iframe.",
      schema: z.object({}),
    }
  );

  const frameClickTool = tool(
    async ({ frameIndex, selector }: { frameIndex: number; selector: string }) => {
      logger.browser(`Clicking in frame ${frameIndex}: ${selector}`);
      const page = await browserController.ensure();
      const frames = page.frames();
      if (frameIndex < 0 || frameIndex >= frames.length) {
        return `ERROR: Invalid frame index ${frameIndex}. Page has ${frames.length} frames (0 to ${frames.length - 1}). Use browser_list_frames to see frames.`;
      }
      const frame = frames[frameIndex];
      await frame.click(selector, { timeout: 10000 });
      logger.browser(`✓ Clicked in frame`);
      return `Clicked ${selector} in frame ${frameIndex}.`;
    },
    {
      name: "browser_frame_click",
      description: "Click an element inside an iframe. Use frameIndex from browser_list_frames and a CSS selector.",
      schema: z.object({
        frameIndex: z.number(),
        selector: z.string(),
      }),
    }
  );

  const frameExtractTextTool = tool(
    async ({ frameIndex, selector }: { frameIndex: number; selector: string }) => {
      logger.browser(`Extracting text from frame ${frameIndex}: ${selector}`);
      const page = await browserController.ensure();
      const frames = page.frames();
      if (frameIndex < 0 || frameIndex >= frames.length) {
        return `ERROR: Invalid frame index ${frameIndex}. Page has ${frames.length} frames. Use browser_list_frames to see frames.`;
      }
      const frame = frames[frameIndex];
      const el = await frame.$(selector);
      if (!el) return `No element found in frame ${frameIndex} for selector: ${selector}`;
      const text = (await el.innerText()).trim();
      const clipped = text.substring(0, 5000);
      logger.browser(`✓ Extracted ${clipped.length} chars from frame`);
      return `Frame ${frameIndex} content (${clipped.length} chars):\n${clipped}`;
    },
    {
      name: "browser_frame_extract_text",
      description: "Extract text from an element inside an iframe. Use frameIndex from browser_list_frames.",
      schema: z.object({
        frameIndex: z.number(),
        selector: z.string(),
      }),
    }
  );

  const doubleClickTool = tool(
    async ({ selector }: { selector: string }) => {
      logger.browser(`Double-clicking: ${selector}`);
      const page = await browserController.ensure();
      await page.dblclick(selector, { timeout: 10000 });
      logger.browser(`✓ Double-clicked`);
      return `Double-clicked ${selector}.`;
    },
    {
      name: "browser_double_click",
      description: "Double-click an element. Use for elements that require double-click to activate.",
      schema: z.object({
        selector: z.string(),
      }),
    }
  );

  const scrollToElementTool = tool(
    async ({ selector, clickAfter }: { selector: string; clickAfter?: boolean }) => {
      logger.browser(`Scrolling to: ${selector}`);
      const page = await browserController.ensure();
      await page.locator(selector).scrollIntoViewIfNeeded({ timeout: 10000 });
      if (clickAfter) {
        await page.click(selector, { timeout: 5000 });
        logger.browser(`✓ Scrolled and clicked`);
        return `Scrolled to ${selector} and clicked it.`;
      }
      logger.browser(`✓ Scrolled into view`);
      return `Scrolled so ${selector} is in view.`;
    },
    {
      name: "browser_scroll_to_element",
      description: "Scroll the page so an element is in view. Optionally click it after scrolling (clickAfter: true).",
      schema: z.object({
        selector: z.string(),
        clickAfter: z.boolean().optional(),
      }),
    }
  );

  const getConsoleErrorsTool = tool(
    async () => {
      logger.browser("Getting console errors");
      const page = await browserController.ensure();
      const logs: string[] = [];
      const handler = (msg: any) => {
        const type = msg.type();
        const text = msg.text();
        if (type === "error" || type === "warning") {
          logs.push(`[${type}] ${text}`);
        }
      };
      page.on("console", handler);
      await new Promise((r) => setTimeout(r, 500));
      page.off("console", handler);
      if (logs.length === 0) {
        return "No console errors or warnings in the last 500ms. Errors may have occurred earlier during page load.";
      }
      return `Console messages:\n${logs.slice(0, 20).join("\n")}`;
    },
    {
      name: "browser_get_console_errors",
      description: "Get JavaScript console errors/warnings from the page (captures messages for 500ms). Use for debugging when the page behaves oddly.",
      schema: z.object({}),
    }
  );

  const getCookiesTool = tool(
    async () => {
      logger.browser("Getting cookies");
      const context = await browserController.ensure().then((p) => p.context());
      const cookies = await context.cookies();
      const summary = cookies.map((c) => ({ name: c.name, domain: c.domain, path: c.path }));
      logger.browser(`Found ${cookies.length} cookie(s)`);
      return `Cookies (${cookies.length}): ${JSON.stringify(summary, null, 2)}`;
    },
    {
      name: "browser_get_cookies",
      description: "List cookies for the current browser context. Use to check login or consent state.",
      schema: z.object({}),
    }
  );

  const extractVisibleTextTool = tool(
    async ({ maxChars }: { maxChars?: number }) => {
      logger.browser("Extracting all visible text");
      const page = await browserController.ensure();
      const text = await page.evaluate(() => {
        const body = (globalThis as any).document?.body;
        return body ? body.innerText : "";
      });
      const limit = maxChars ?? 8000;
      const clipped = text.trim().substring(0, limit);
      logger.browser(`✓ Extracted ${clipped.length} chars`);
      return `Visible text (${clipped.length} chars):\n${clipped}`;
    },
    {
      name: "browser_extract_visible_text",
      description: "Get all visible text from the page (no selector). Useful for a quick full-page read. Optionally limit length with maxChars.",
      schema: z.object({
        maxChars: z.number().optional(),
      }),
    }
  );

  const getMetaTool = tool(
    async () => {
      logger.browser("Getting meta tags");
      const page = await browserController.ensure();
      const meta = await page.$$eval("meta[name], meta[property]", (nodes: any[]) => {
        return nodes.map((n) => ({
          name: n.getAttribute("name") || n.getAttribute("property"),
          content: n.getAttribute("content")?.substring(0, 200),
        }));
      });
      const title = await page.title();
      const desc = meta.find((m) => m.name === "description" || m.name === "og:description");
      logger.browser(`✓ Got ${meta.length} meta tags`);
      return `Title: ${title}\nMeta: ${JSON.stringify(meta.slice(0, 15), null, 2)}${desc ? `\nDescription: ${desc.content}` : ""}`;
    },
    {
      name: "browser_get_meta",
      description: "Get page title and meta tags (description, og:title, etc.) for a quick summary of the page.",
      schema: z.object({}),
    }
  );

  return [
    gotoTool,
    clickTool,
    rightClickTool,
    typeTool,
    scrollTool,
    screenshotTool,
    extractTextTool,
    findByTextTool,
    findLinksTool,
    extractMultipleTool,
    checkPopupsTool,
    analyzePageTool,
    getUrlTool,
    backTool,
    waitTool,
    hoverTool,
    pressKeyTool,
    refreshTool,
    selectOptionTool,
    checkCheckboxTool,
    uploadFileTool,
    searchGoogleTool,
    fillAndSubmitSearchTool,
    listFramesTool,
    frameClickTool,
    frameExtractTextTool,
    doubleClickTool,
    scrollToElementTool,
    getConsoleErrorsTool,
    getCookiesTool,
    extractVisibleTextTool,
    getMetaTool,
  ];
}

