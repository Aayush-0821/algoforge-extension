interface ProblemData {
  number: string;
  title: string;
  difficulty: string;
  language: string;
  url: string;
}

const ROOT_ID = "algoforge-extension-root";

let currentProblem: ProblemData | null = null;

let lastKnownUrl = window.location.href;

let routeChangeTimer: ReturnType<typeof setTimeout> | null = null;

let routeChangeVersion = 0;

let panelWasOpenDuringNavigation = false;

/* =======================================================
   EXTENSION ASSET URL
======================================================= */

function getExtensionAssetUrl(
  path: string
): string {
  try {
    return chrome.runtime.getURL(path);
  } catch {
    /*
     * Chrome invalidates content-script extension contexts
     * when the unpacked extension is reloaded. Returning an
     * empty URL prevents the old page from throwing repeatedly.
     */

    return "";
  }
}

/* =======================================================
   ROOT
======================================================= */

function getRoot(): HTMLElement {
  const existing = document.getElementById(ROOT_ID);

  if (existing) {
    return existing;
  }

  const root = document.createElement("div");

  root.id = ROOT_ID;

  document.body.appendChild(root);

  return root;
}

/* =======================================================
   PROBLEM NUMBER + TITLE
======================================================= */

function getProblemNumberAndTitle(): {
  number: string;
  title: string;
} {
  /*
   * LeetCode has changed its DOM structure several times.
   *
   * We first check the known question-title selector,
   * then h1 elements, then scan visible elements for
   * the "3. Problem Title" pattern.
   */

  const possibleElements: Element[] = [];

  const questionTitle = document.querySelector(
    '[data-cy="question-title"]'
  );

  if (questionTitle) {
    possibleElements.push(questionTitle);
  }

  const h1Elements = document.querySelectorAll("h1");

  for (const element of Array.from(h1Elements)) {
    possibleElements.push(element);
  }

  const titleCandidates =
    document.querySelectorAll(
      '[class*="title"], [class*="Title"]'
    );

  for (const element of Array.from(titleCandidates)) {
    possibleElements.push(element);
  }

  /*
   * Try to find an element whose text actually contains
   * the problem number.
   */

  for (const element of possibleElements) {
    const text =
      element.textContent?.trim() || "";

    const match = text.match(
      /^(\d+)\.\s*(.+)$/
    );

    if (match) {
      return {
        number: match[1],
        title: match[2].trim()
      };
    }
  }

  /*
   * Fallback: scan visible text elements.
   *
   * This is particularly useful with the current
   * LeetCode layout where the problem title can be
   * rendered through nested components.
   */

  const textElements =
    document.querySelectorAll(
      "div, span, a"
    );

  for (const element of Array.from(textElements)) {
    const text =
      element.textContent?.trim() || "";

    /*
     * Avoid huge containers. We only want short
     * pieces of text that look like a problem title.
     */

    if (
      text.length > 3 &&
      text.length < 150
    ) {
      const match = text.match(
        /^(\d+)\.\s*(.+)$/
      );

      if (match) {
        return {
          number: match[1],
          title: match[2].trim()
        };
      }
    }
  }

  /*
   * Last fallback:
   *
   * Some LeetCode pages have the problem number
   * available in the URL/page metadata.
   */

  const numberFromUrl =
    extractProblemNumberFromUrl();

  const rawTitle =
    document.title
      .replace(
        /\s*-\s*LeetCode.*$/i,
        ""
      )
      .trim();

  return {
    number: numberFromUrl || "—",
    title: rawTitle
  };
}

/* =======================================================
   NUMBER FROM URL / METADATA
======================================================= */

function extractProblemNumberFromUrl(): string | null {
  /*
   * LeetCode URLs generally contain the slug, not
   * the numeric problem ID, so this is a fallback only.
   *
   * We also inspect metadata that may contain the
   * problem ID.
   */

  const metaSelectors = [
    'meta[name="problemId"]',
    'meta[property="problemId"]',
    'meta[name="questionId"]'
  ];

  for (const selector of metaSelectors) {
    const element =
      document.querySelector(selector);

    const value =
      element?.getAttribute("content");

    if (
      value &&
      /^\d+$/.test(value)
    ) {
      return value;
    }
  }

  /*
   * Search the page source for common problem ID
   * structures used by LeetCode.
   */

  const html =
    document.documentElement.innerHTML;

  const patterns = [
    /"questionFrontendId"\s*:\s*"(\d+)"/,
    /"questionFrontendId"\s*:\s*(\d+)/,
    /"frontendQuestionId"\s*:\s*"(\d+)"/,
    /"frontendQuestionId"\s*:\s*(\d+)/
  ];

  for (const pattern of patterns) {
    const match =
      html.match(pattern);

    if (match) {
      return match[1];
    }
  }

  return null;
}

/* =======================================================
   DIFFICULTY
======================================================= */

function getDifficulty(): string {
  const selectors = [
    '[diff]',
    '[data-difficulty]',
    '[class*="difficulty"]',
    '[class*="Difficulty"]'
  ];

  for (const selector of selectors) {
    const elements =
      document.querySelectorAll(selector);

    for (const element of Array.from(elements)) {
      const text =
        element.textContent?.trim() || "";

      if (
        /^(Easy|Medium|Hard)$/i.test(text)
      ) {
        return capitalize(text);
      }
    }
  }

  /*
   * Current LeetCode layout fallback.
   */

  const allElements =
    document.querySelectorAll(
      "span, div, button"
    );

  for (const element of Array.from(allElements)) {
    const text =
      element.textContent?.trim() || "";

    if (
      text === "Easy" ||
      text === "Medium" ||
      text === "Hard"
    ) {
      return capitalize(text);
    }
  }

  return "Unknown";
}

/* =======================================================
   LANGUAGE
======================================================= */

function getSelectedLanguage(): string {
  const selectors = [
    'button[aria-label*="language" i]',
    'button[data-cy*="language" i]',
    '[data-mode-id]',
    '[class*="language"]',
    '[class*="Language"]'
  ];

  for (const selector of selectors) {
    const elements =
      document.querySelectorAll(selector);

    for (const element of Array.from(elements)) {
      const text =
        element.textContent?.trim() || "";

      const language =
        extractLanguage(text);

      if (language) {
        return language;
      }
    }
  }

  /*
   * Current editor header fallback.
   */

  const buttons =
    document.querySelectorAll(
      "button, [role='button']"
    );

  for (const element of Array.from(buttons)) {
    const text =
      element.textContent?.trim() || "";

    const language =
      extractLanguage(text);

    if (language) {
      return language;
    }
  }

  return "Unknown";
}

/* =======================================================
   LANGUAGE HELPERS
======================================================= */

function extractLanguage(
  text: string
): string | null {
  const languages = [
    "C++",
    "C#",
    "C",
    "Java",
    "JavaScript",
    "TypeScript",
    "Python",
    "Python3",
    "Go",
    "Rust",
    "Kotlin",
    "Swift",
    "PHP",
    "Ruby",
    "Scala",
    "Dart",
    "R",
    "SQL"
  ];

  const normalized =
    text.trim().toLowerCase();

  for (const language of languages) {
    if (
      normalized ===
      language.toLowerCase()
    ) {
      return normalizeLanguage(language);
    }
  }

  return null;
}

function normalizeLanguage(
  language: string
): string {
  const value =
    language.trim();

  if (
    value.toLowerCase() ===
    "python3"
  ) {
    return "Python";
  }

  if (
    value.toLowerCase() ===
    "javascript"
  ) {
    return "JavaScript";
  }

  if (
    value.toLowerCase() ===
    "typescript"
  ) {
    return "TypeScript";
  }

  return value;
}

/* =======================================================
   GENERAL HELPERS
======================================================= */

function capitalize(
  value: string
): string {
  return (
    value.charAt(0).toUpperCase() +
    value.slice(1).toLowerCase()
  );
}

function escapeHtml(
  value: string
): string {
  const div =
    document.createElement("div");

  div.textContent = value;

  return div.innerHTML;
}

function getDifficultyClass(
  difficulty: string
): string {
  return difficulty
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/* =======================================================
   CAPTURE
======================================================= */

function captureProblem(): ProblemData {
  const {
    number,
    title
  } = getProblemNumberAndTitle();

  return {
    number,
    title,
    difficulty: getDifficulty(),
    language: getSelectedLanguage(),
    url: window.location.href
  };
}

/* =======================================================
   LAUNCHER
======================================================= */

function renderLauncher(): void {
  const root = getRoot();

  if (!root.dataset.theme) {
    root.dataset.theme =
      getInitialTheme();
  }

  root.innerHTML = `
    <button
      id="algoforge-launcher"
      class="algoforge-launcher"
      type="button"
      aria-label="Open AlgoForge"
      title="Analyze"
    >
      <img
        src="${getExtensionAssetUrl(
          "images/forgey.png"
        )}"
        alt="Forgey"
      />
    </button>
  `;

  const launcher =
    document.getElementById(
      "algoforge-launcher"
    );

  launcher?.classList.remove(
    "is-loading"
  );

  launcher?.setAttribute(
    "aria-label",
    "Open AlgoForge"
  );

  launcher?.addEventListener(
    "click",
    openCapturePanel
  );
}

/* =======================================================
   CAPTURE PANEL
======================================================= */

function openCapturePanel(): void {
  currentProblem =
    captureProblem();

  renderCapturePanel(
    currentProblem
  );
}

function renderCapturePanel(
  problem: ProblemData
): void {
  const root = getRoot();

  if (!root.dataset.theme) {
    root.dataset.theme =
      getInitialTheme();
  }

  root.innerHTML = `
    <section
      class="algoforge-panel"
      role="dialog"
      aria-label="AlgoForge"
    >

      <header class="algoforge-header">

        <div class="algoforge-brand">

          <div class="algoforge-brand-icon">
            <img
              src="${getExtensionAssetUrl(
                "images/forgey.png"
              )}"
              alt="Forgey"
            />
          </div>

          <div class="algoforge-brand-text">

            <div class="algoforge-brand-name">
              AlgoForge
            </div>

            <div class="algoforge-brand-subtitle">
              Code smarter. Forge stronger.
            </div>

          </div>

        </div>

        <div class="algoforge-header-actions">

          <button
            id="algoforge-github"
            class="algoforge-icon-button github-button"
            type="button"
            aria-label="GitHub Revision Vault"
            title="GitHub Revision Vault"
          >
            <span class="github-icon" aria-hidden="true">
              ${getGitHubIconSvg()}
            </span>
          </button>

          <button
            id="algoforge-theme"
            class="algoforge-icon-button theme-button"
            type="button"
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            <span
              id="algoforge-theme-icon"
              class="theme-icon"
            ></span>
          </button>

          <button
            id="algoforge-close"
            class="algoforge-icon-button close-button"
            type="button"
            aria-label="Close"
            title="Close"
          >
            <span class="close-icon">×</span>
          </button>

        </div>

      </header>

      <div class="algoforge-content">

        <div class="algoforge-problem-number">
          PROBLEM #${escapeHtml(
            problem.number
          )}
        </div>

        <h1 class="algoforge-problem-title">
          ${escapeHtml(
            problem.title
          )}
        </h1>

        <div class="algoforge-info">

          <div class="algoforge-info-row">

            <div class="algoforge-info-label">

              <span class="info-icon">
                &lt;/&gt;
              </span>

              <span>
                Coding Language
              </span>

            </div>

            <div class="algoforge-info-value">
              ${escapeHtml(
                problem.language
              )}
            </div>

          </div>

          <div class="algoforge-divider"></div>

          <div class="algoforge-info-row">

            <div class="algoforge-info-label">

              <span class="info-icon">
                ◈
              </span>

              <span>
                Difficulty
              </span>

            </div>

            <div
              class="algoforge-difficulty ${getDifficultyClass(
                problem.difficulty
              )}"
            >
              ${escapeHtml(
                problem.difficulty
              )}
            </div>

          </div>

        </div>

        <button
          id="algoforge-analyze"
          class="algoforge-primary-button"
          type="button"
        >
          Analyze
        </button>

        <p class="algoforge-footer">
          Forgey will analyze this problem for you.
        </p>

      </div>

    </section>
  `;

  updateThemeIcon(
    root.dataset.theme
  );

  attachPanelEvents();
}

/* =======================================================
   ANALYSIS SCREEN
======================================================= */

function renderAnalysis(): void {
  if (!currentProblem) {
    return;
  }

  const root = getRoot();

  root.innerHTML = `
    <section
      class="algoforge-panel algoforge-analysis-panel"
      role="dialog"
      aria-label="AlgoForge Analysis"
    >

      <header class="algoforge-header">

        <div class="algoforge-brand">

          <div class="algoforge-brand-icon">
            <img
              src="${getExtensionAssetUrl(
                "images/forgey.png"
              )}"
              alt="Forgey"
            />
          </div>

          <div class="algoforge-brand-text">

            <div class="algoforge-brand-name">
              AlgoForge
            </div>

            <div class="algoforge-brand-subtitle">
              AI Analysis
            </div>

          </div>

        </div>

        <button
          id="algoforge-close"
          class="algoforge-icon-button close-button"
          type="button"
          aria-label="Close"
        >
          <span class="close-icon">×</span>
        </button>

      </header>

      <div class="algoforge-analysis-content">

        <div class="algoforge-analysis-forgey">

          <img
            src="${getExtensionAssetUrl(
              "images/forgey.png"
            )}"
            alt="Forgey"
          />

        </div>

        <div class="algoforge-analysis-status">
          Analyzing problem
          <span class="analysis-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>

        <p class="algoforge-analysis-description">
          Forgey is preparing your analysis.
        </p>

        <div class="algoforge-analysis-problem">

          <span>
            #${escapeHtml(
              currentProblem.number
            )}
          </span>

          <strong>
            ${escapeHtml(
              currentProblem.title
            )}
          </strong>

        </div>

        <div class="algoforge-analysis-loader">

          <span></span>
          <span></span>
          <span></span>

        </div>

      </div>

    </section>
  `;

  document
    .getElementById(
      "algoforge-close"
    )
    ?.addEventListener(
      "click",
      renderLauncher
    );

  /*
   * Backend integration point.
   *
   * Your teammate can connect this message
   * to the real AlgoForge API later.
   */

  chrome.runtime.sendMessage(
    {
      type: "ANALYZE_PROBLEM",
      problem: currentProblem
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.debug(
          "AlgoForge extension context is no longer available:",
          chrome.runtime.lastError.message
        );

        return;
      }

      if (!response?.success) {
        console.debug(
          "AlgoForge could not capture the solution code:",
          response?.message
        );
      }
    }
  );
}

/* =======================================================
   EVENTS
======================================================= */

function attachPanelEvents(): void {
  document
    .getElementById(
      "algoforge-close"
    )
    ?.addEventListener(
      "click",
      renderLauncher
    );

  document
    .getElementById(
      "algoforge-analyze"
    )
    ?.addEventListener(
      "click",
      renderAnalysis
    );

  document
    .getElementById(
      "algoforge-theme"
    )
    ?.addEventListener(
      "click",
      toggleTheme
    );

  document
    .getElementById(
      "algoforge-github"
    )
    ?.addEventListener(
      "click",
      handleGitHubClick
    );
}

/* =======================================================
   GITHUB REVISION VAULT
======================================================= */

function getGitHubIconSvg(): string {
  return `
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.53-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.73-1.52-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.06 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.77.11 3.06.73.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.67.41.36.78 1.08.78 2.18v3.23c0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z"
      />
    </svg>
  `;
}

function handleGitHubClick(): void {
  chrome.runtime.sendMessage(
    { type: "GITHUB_STATUS" },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[AlgoForge] GitHub status error:",
          chrome.runtime.lastError
        );

        showGitHubConnectPanel();
        return;
      }

      console.log("[AlgoForge] GitHub status response:", response);

      if (response?.connected === true) {
        showGitHubRevisionPanel();
        return;
      }

      showGitHubConnectPanel();
    }
  );
}

function showGitHubConnectPanel(): void {
  const root = getRoot();

  root.innerHTML = `
    <section
      class="algoforge-panel algoforge-github-panel"
      role="dialog"
      aria-label="Connect GitHub"
    >
      <header class="algoforge-header">
        <div class="algoforge-brand">
          <div class="algoforge-brand-icon">
            <span class="github-panel-icon">
              ${getGitHubIconSvg()}
            </span>
          </div>

          <div class="algoforge-brand-text">
            <div class="algoforge-brand-name">GitHub</div>
            <div class="algoforge-brand-subtitle">Revision Vault</div>
          </div>
        </div>

        <button
          id="algoforge-github-close"
          class="algoforge-icon-button close-button"
          type="button"
          aria-label="Close"
          title="Close"
        >
          <span class="close-icon">×</span>
        </button>
      </header>

      <div class="algoforge-github-content">
        <div class="algoforge-github-hero">
          <div class="algoforge-github-large-icon">
            ${getGitHubIconSvg()}
          </div>

          <h2>Connect GitHub</h2>

          <p>
            Connect your GitHub account to save
            AlgoForge problem summaries for revision.
          </p>
        </div>

        <button
          id="algoforge-connect-github"
          class="algoforge-github-connect-button"
          type="button"
        >
          Connect GitHub
        </button>

        <p class="algoforge-github-note">
          GitHub authentication will be connected here.
        </p>
      </div>
    </section>
  `;

  document
    .getElementById("algoforge-github-close")
    ?.addEventListener("click", renderLauncher);

  document
  .getElementById(
    "algoforge-connect-github",
  )
  ?.addEventListener(
    "click",
    () => {
      chrome.runtime.sendMessage(
        {
          type: "OPEN_GITHUB_CONNECT",
        },
        (response) => {
          if (
            chrome.runtime.lastError
          ) {
            console.error(
              "[AlgoForge] GitHub connection error:",
              chrome.runtime.lastError.message,
            );

            return;
          }

          if (
            !response?.success
          ) {
            console.error(
              "[AlgoForge] Unable to open GitHub connection:",
              response?.message,
            );
          }
        },
      );
    },
  );
}

function showGitHubRevisionPanel(): void {
  if (!currentProblem) {
    renderLauncher();
    return;
  }

  const root = getRoot();

  root.innerHTML = `
    <section
      class="algoforge-panel algoforge-github-panel"
      role="dialog"
      aria-label="GitHub Revision Vault"
    >
      <header class="algoforge-header">
        <div class="algoforge-brand">
          <div class="algoforge-brand-icon">
            <span class="github-panel-icon">
              ${getGitHubIconSvg()}
            </span>
          </div>

          <div class="algoforge-brand-text">
            <div class="algoforge-brand-name">Revision Vault</div>
            <div class="algoforge-brand-subtitle">GitHub connected</div>
          </div>
        </div>

        <button
          id="algoforge-github-close"
          class="algoforge-icon-button close-button"
          type="button"
          aria-label="Close"
          title="Close"
        >
          <span class="close-icon">×</span>
        </button>
      </header>

      <div class="algoforge-github-content">
        <div class="algoforge-github-problem">
          <span>#${escapeHtml(currentProblem.number)}</span>
          <strong>${escapeHtml(currentProblem.title)}</strong>
        </div>

        <p class="algoforge-github-description">
          Forge a revision summary for this problem
          and save it to your GitHub revision vault.
        </p>

        <button
          id="algoforge-save-github"
          class="algoforge-github-connect-button"
          type="button"
        >
          Save to GitHub
        </button>
      </div>
    </section>
  `;

  document
    .getElementById("algoforge-github-close")
    ?.addEventListener("click", renderLauncher);

  document
  .getElementById("algoforge-save-github")
  ?.addEventListener(
    "click",
    async () => {
      const button =
        document.getElementById(
          "algoforge-save-github",
        ) as HTMLButtonElement | null;

      const problem = currentProblem;

      if (!problem || !button) {
        return;
      }

      button.disabled = true;
      button.textContent = "Saving...";

      try {
        /* -----------------------------------------
           Capture solution code
        ----------------------------------------- */

        const codeResponse =
          await new Promise<any>(
            (resolve) => {
              chrome.runtime.sendMessage(
                {
                  type: "ANALYZE_PROBLEM",
                  problem,
                },
                resolve,
              );
            },
          );

        if (!codeResponse?.success) {
          throw new Error(
            codeResponse?.message ||
              "Unable to capture your solution code.",
          );
        }

        const data =
          codeResponse.data || {};

        if (!data.code?.trim()) {
          throw new Error(
            "No solution code was found in the LeetCode editor.",
          );
        }

        /* -----------------------------------------
           Create Revision Vault entry
        ----------------------------------------- */

        const response =
          await new Promise<any>(
            (resolve) => {
              chrome.runtime.sendMessage(
                {
                  type: "CREATE_REVISION_VAULT",

                  payload: {
                    problemNumber:
                      data.problemNumber ||
                      problem.number,

                    problemTitle:
                      data.problemTitle ||
                      problem.title,

                    difficulty:
                      data.problemDifficulty ||
                      problem.difficulty,

                    language:
                      data.language ||
                      problem.language,

                    problemUrl:
                      data.url ||
                      problem.url,

                    code: data.code,
                  },
                },
                resolve,
              );
            },
          );

        /* -----------------------------------------
           Backend error
        ----------------------------------------- */

        if (!response?.success) {
          throw new Error(
            response?.message ||
              "Unable to save revision to GitHub.",
          );
        }

        /* -----------------------------------------
           Success
        ----------------------------------------- */

        button.textContent = "Saved ✓";

        const githubUrl =
          response?.revision?.commitUrl ||
          response?.revision?.repositoryUrl;

        if (githubUrl) {
          const existingLink =
            document.querySelector(
              ".algoforge-github-result-link",
            );

          existingLink?.remove();

          const link =
            document.createElement("a");

          link.href = githubUrl;

          link.target = "_blank";

          link.rel =
            "noopener noreferrer";

          link.textContent =
            "Open on GitHub";

          link.className =
            "algoforge-github-result-link";

          button.insertAdjacentElement(
            "afterend",
            link,
          );
        }
      } catch (error) {
        console.error(
          "[AlgoForge] Failed to save revision:",
          error,
        );

        button.disabled = false;

        button.textContent =
          "Save to GitHub";

        const message =
          error instanceof Error
            ? error.message
            : "Unable to save revision.";

        alert(message);
      }
    },
  );
}

/* =======================================================
   THEME
======================================================= */

function toggleTheme(): void {
  const root = getRoot();

  const current =
    root.dataset.theme ||
    getInitialTheme();

  const next =
    current === "dark"
      ? "light"
      : "dark";

  root.dataset.theme = next;

  updateThemeIcon(next);
}

function updateThemeIcon(
  theme: string
): void {
  const icon =
    document.getElementById(
      "algoforge-theme-icon"
    );

  if (!icon) {
    return;
  }

  icon.className =
    `theme-icon ${
      theme === "dark"
        ? "theme-sun"
        : "theme-moon"
    }`;
}

function getInitialTheme(): string {
  return window.matchMedia(
    "(prefers-color-scheme: dark)"
  ).matches
    ? "dark"
    : "light";
}

/* =======================================================
   ROUTE / PROBLEM CHANGE
======================================================= */

/*
 * LeetCode is a SPA. Changing a problem from the Problem
 * List normally changes the URL and replaces the problem
 * DOM without a full browser refresh.
 */

function isProblemPage(): boolean {
  return window.location.pathname.startsWith(
    "/problems/"
  );
}

function showProblemChangeLoading(): void {
  const root = getRoot();

  panelWasOpenDuringNavigation =
    Boolean(
      root.querySelector(
        ".algoforge-panel"
      )
    );

  if (!root.dataset.theme) {
    root.dataset.theme =
      getInitialTheme();
  }

  /*
   * If the extension panel is open, keep the panel open
   * and show a loading state while LeetCode changes pages.
   */

  if (panelWasOpenDuringNavigation) {
    renderProblemChangePanel();
    return;
  }

  /*
   * Otherwise, keep the compact Forgey launcher in place
   * and animate it instead of unexpectedly opening the UI.
   */

  const launcher =
    document.getElementById(
      "algoforge-launcher"
    );

  if (launcher) {
    launcher.classList.add(
      "is-loading"
    );

    launcher.setAttribute(
      "aria-label",
      "Loading new problem"
    );
  }
}

function renderProblemChangePanel(): void {
  const root = getRoot();

  root.innerHTML = `
    <section
      class="algoforge-panel algoforge-change-panel"
      role="status"
      aria-live="polite"
      aria-label="Loading new problem"
    >

      <header class="algoforge-header">

        <div class="algoforge-brand">

          <div class="algoforge-brand-icon">
            <img
              src="${getExtensionAssetUrl(
                "images/forgey.png"
              )}"
              alt="Forgey"
            />
          </div>

          <div class="algoforge-brand-text">

            <div class="algoforge-brand-name">
              AlgoForge
            </div>

            <div class="algoforge-brand-subtitle">
              Code smarter. Forge stronger.
            </div>

          </div>

        </div>

        <div class="algoforge-header-actions">
          <span
            class="algoforge-loading-spinner"
            aria-hidden="true"
          ></span>
        </div>

      </header>

      <div class="algoforge-change-loading">

        <div class="algoforge-change-forgey">
          <img
            src="${getExtensionAssetUrl(
              "images/forgey.png"
            )}"
            alt="Forgey"
          />
        </div>

        <div class="algoforge-change-title">
          Loading problem
        </div>

        <div class="algoforge-change-subtitle">
          Forgey is getting the new problem ready
          <span class="analysis-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>

        <div class="algoforge-progress">
          <span></span>
        </div>

      </div>

    </section>
  `;
}

function finishProblemChange(
  expectedUrl: string,
  version: number
): void {
  /*
   * Ignore stale callbacks if another navigation happened.
   */

  if (
    version !== routeChangeVersion ||
    window.location.href !== expectedUrl
  ) {
    return;
  }

  if (!isProblemPage()) {
    currentProblem = null;

    getRoot().innerHTML = "";

    return;
  }

  const problem =
    captureProblem();

  /*
   * Wait for LeetCode's React tree to finish rendering.
   * This prevents us from briefly capturing the previous
   * problem or an empty title.
   */

  const titleLooksReady =
    Boolean(problem.title) &&
    problem.title !== "LeetCode" &&
    problem.title !==
      "LeetCode - The World's Leading Online Programming Learning Platform";

  const metadataLooksReady =
    problem.number !== "—" ||
    problem.difficulty !== "Unknown" ||
    problem.language !== "Unknown";

  if (
    !titleLooksReady &&
    !metadataLooksReady
  ) {
    if (
      version === routeChangeVersion
    ) {
      routeChangeTimer =
        setTimeout(
          () =>
            finishProblemChange(
              expectedUrl,
              version
            ),
          400
        );
    }

    return;
  }

  currentProblem = problem;

  /*
   * If the user had the panel open, update the panel
   * with the new problem. Otherwise restore the launcher.
   */

  if (panelWasOpenDuringNavigation) {
    renderCapturePanel(
      currentProblem
    );
  } else {
    renderLauncher();
  }
}

function handleRouteChange(): void {
  const currentUrl =
    window.location.href;

  if (currentUrl === lastKnownUrl) {
    return;
  }

  lastKnownUrl = currentUrl;

  routeChangeVersion += 1;

  const version =
    routeChangeVersion;

  if (routeChangeTimer) {
    clearTimeout(
      routeChangeTimer
    );
  }

  currentProblem = null;

  if (!isProblemPage()) {
    getRoot().innerHTML = "";

    return;
  }

  showProblemChangeLoading();

  /*
   * Allow the LeetCode page to replace its content first.
   */

  routeChangeTimer =
    setTimeout(
      () =>
        finishProblemChange(
          currentUrl,
          version
        ),
      650
    );
}

function installRouteWatcher(): void {
  const originalPushState =
    history.pushState;

  history.pushState =
    function (
      ...args: Parameters<
        History["pushState"]
      >
    ): void {
      originalPushState.apply(
        this,
        args
      );

      handleRouteChange();
    };

  const originalReplaceState =
    history.replaceState;

  history.replaceState =
    function (
      ...args: Parameters<
        History["replaceState"]
      >
    ): void {
      originalReplaceState.apply(
        this,
        args
      );

      handleRouteChange();
    };

  window.addEventListener(
    "popstate",
    handleRouteChange
  );

  /*
   * Final fallback for router transitions that don't emit
   * a useful history event.
   */

  setInterval(
    handleRouteChange,
    300
  );
}

/* =======================================================
   INITIALIZE
======================================================= */

function initialize(): void {
  if (!isProblemPage()) {
    return;
  }

  const root = getRoot();

  root.dataset.theme =
    getInitialTheme();

  /*
   * Capture the initial problem immediately.
   */

  currentProblem =
    captureProblem();

  renderLauncher();

  installRouteWatcher();

  /*
   * Keep the captured metadata synchronized while the
   * user remains on the same problem. This also catches
   * language changes in the LeetCode editor.
   */

  setInterval(() => {
    if (!isProblemPage()) {
      return;
    }

    if (
      window.location.href !==
      lastKnownUrl
    ) {
      handleRouteChange();
      return;
    }

    const latest =
      captureProblem();

    if (!currentProblem) {
      currentProblem =
        latest;

      return;
    }

    if (
      latest.language !==
        currentProblem.language ||
      latest.difficulty !==
        currentProblem.difficulty ||
      latest.number !==
        currentProblem.number ||
      latest.title !==
        currentProblem.title
    ) {
      currentProblem =
        latest;
    }
  }, 1000);
}

initialize();
