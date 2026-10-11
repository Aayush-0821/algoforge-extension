export {};

const ALGOFORGE_API_BASE = "http://localhost:5000/api";

type BackgroundGitHubApiResponse = {
  success?: boolean;
  connected?: boolean;
  data?: any;
  revision?: any;
  github?: {
    id?: string;
    username?: string;
    email?: string;
    avatarUrl?: string;
  };
  message?: string;
};

type RevisionVaultPayload = {
  problemNumber: string;
  problemTitle: string;
  difficulty: string;
  language: string;
  problemUrl: string;
  code: string;
};

type AnalyzeProblemMessage = {
  type: "ANALYZE_PROBLEM";

  payload?: {
    problemNumber?: string;
    problemTitle?: string;
    problemDifficulty?: string;
    language?: string;
    code?: string;
    url?: string;
  };

  problem?: {
    number?: string;
    title?: string;
    difficulty?: string;
    language?: string;
    url?: string;
  };
};

type ExtensionMessage =
  | {
      type: "PING";
    }
  | AnalyzeProblemMessage
  | {
      type: "GITHUB_STATUS";
    }
  | {
      type: "OPEN_GITHUB_CONNECT";
    }
  | {
      type: "CREATE_REVISION_VAULT";
      payload: RevisionVaultPayload;
    };

/* =======================================================
   BACKEND API
======================================================= */

async function githubBackendRequest(
  path: string,
  init: RequestInit = {}
): Promise<BackgroundGitHubApiResponse> {
  const url = `${ALGOFORGE_API_BASE}${path}`;

  console.log("[AlgoForge] Backend request starting:", {
    url,
    method: init.method || "GET",
  });

  try {
    const response = await fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });

    console.log("[AlgoForge] Backend response received:", {
      status: response.status,
      ok: response.ok,
      url: response.url,
    });

    let body: BackgroundGitHubApiResponse | null = null;

    try {
      body = await response.json();

      console.log("[AlgoForge] Backend response body:", body);
    } catch (error) {
      console.error(
        "[AlgoForge] Failed to parse backend response as JSON:",
        error
      );
    }

    if (!response.ok) {
      console.error("[AlgoForge] Backend request failed:", {
        status: response.status,
        body,
      });

      return {
        success: false,
        connected: false,
        message:
          body?.message ||
          `AlgoForge server returned HTTP ${response.status}`,
      };
    }

    return body || { success: true };
  } catch (error) {
    console.error("[AlgoForge] Backend fetch exception:", error);

    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to connect to the AlgoForge server.",
    };
  }
}

/* =======================================================
   GITHUB
======================================================= */

async function getGitHubStatus(): Promise<BackgroundGitHubApiResponse> {
  return githubBackendRequest(
    "/github/status",
    {
      method: "GET",
    },
  );
}

async function openGitHubConnect(): Promise<void> {
  await chrome.tabs.create({
    url: `${ALGOFORGE_API_BASE}/auth/github/connect`,
  });
}

async function createRevisionVault(
  payload: RevisionVaultPayload,
): Promise<BackgroundGitHubApiResponse> {
  return githubBackendRequest(
    "/github/revision-vault",
    {
      method: "POST",

      body: JSON.stringify(payload),
    },
  );
}

/* =======================================================
   ACTIVE TAB
======================================================= */

async function getActiveTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  const tabId = tabs[0]?.id;

  if (typeof tabId !== "number") {
    throw new Error(
      "No active browser tab found.",
    );
  }

  return tabId;
}

/* =======================================================
   LEETCODE CODE CAPTURE
======================================================= */

async function captureLeetCodeCode(): Promise<string> {
  try {
    const tabId =
      await getActiveTabId();

    const results =
      await chrome.scripting.executeScript({
        target: {
          tabId,
        },

        world: "MAIN",

        func: () => {
          /* ---------------------------------------------
             Monaco
          --------------------------------------------- */

          try {
            const monaco =
              (window as any).monaco;

            if (
              monaco?.editor?.getEditors
            ) {
              const editors =
                monaco.editor.getEditors();

              if (editors?.length) {
                for (
                  const editor of editors
                ) {
                  try {
                    const value =
                      editor.getValue?.();

                    if (
                      typeof value ===
                        "string" &&
                      value.trim()
                    ) {
                      return value;
                    }
                  } catch {
                    // Continue.
                  }
                }
              }
            }
          } catch {
            // Continue to DOM fallback.
          }

          /* ---------------------------------------------
             Monaco DOM
          --------------------------------------------- */

          try {
            const lines =
              Array.from(
                document.querySelectorAll(
                  ".monaco-editor .view-lines .view-line",
                ),
              );

            if (lines.length) {
              return lines
                .map((line) =>
                  (
                    line.textContent ||
                    ""
                  ).replace(
                    /\u00a0/g,
                    " ",
                  ),
                )
                .join("\n");
            }
          } catch {
            // Continue.
          }

          /* ---------------------------------------------
             Generic editor fallbacks
          --------------------------------------------- */

          const selectors = [
            "textarea",
            '[contenteditable="true"]',
            ".view-lines",
            ".CodeMirror-code",
          ];

          for (
            const selector of selectors
          ) {
            const element =
              document.querySelector(
                selector,
              );

            if (!element) {
              continue;
            }

            if (
              element instanceof
                HTMLTextAreaElement &&
              element.value.trim()
            ) {
              return element.value;
            }

            const text =
              element.textContent ||
              "";

            if (text.trim()) {
              return text;
            }
          }

          return "";
        },
      });

    return (
      (results?.[0]?.result as string) ||
      ""
    );
  } catch (error) {
    console.error(
      "[AlgoForge] Failed to capture code:",
      error,
    );

    return "";
  }
}

/* =======================================================
   ANALYZE PROBLEM
======================================================= */

async function handleAnalyzeProblem(
  message: AnalyzeProblemMessage,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundGitHubApiResponse> {
  const problem =
    message.problem;

  const payload =
    message.payload;

  const problemNumber =
    payload?.problemNumber ||
    problem?.number ||
    "";

  const problemTitle =
    payload?.problemTitle ||
    problem?.title ||
    "";

  const problemDifficulty =
    payload?.problemDifficulty ||
    problem?.difficulty ||
    "";

  const language =
    payload?.language ||
    problem?.language ||
    "";

  const url =
    payload?.url ||
    problem?.url ||
    sender.tab?.url ||
    "";

  const code =
    payload?.code?.trim() ||
    (await captureLeetCodeCode());

  const analysisPayload = {
    problemNumber,
    problemTitle,
    problemDifficulty,
    language,
    code,
    url,
  };

  console.log(
    "[AlgoForge] ANALYZE_PROBLEM payload:",
    analysisPayload,
  );

  return {
    success: true,

    data: analysisPayload,
  };
}

/* =======================================================
   EXTENSION EVENTS
======================================================= */

chrome.runtime.onInstalled.addListener(
  () => {
    console.log(
      "[AlgoForge] Extension installed.",
    );
  },
);

chrome.runtime.onStartup.addListener(
  () => {
    console.log(
      "[AlgoForge] Extension started.",
    );
  },
);

/* =======================================================
   MESSAGE HANDLER
======================================================= */

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (
      response?: any,
    ) => void,
  ) => {
    console.log(
      "[AlgoForge] Message received:",
      message.type,
    );

    /* ---------------------------------------------
       PING
    --------------------------------------------- */

    if (
      message.type === "PING"
    ) {
      sendResponse({
        success: true,
        message:
          "AlgoForge background service is running.",
      });

      return false;
    }

    /* ---------------------------------------------
       ANALYZE PROBLEM
    --------------------------------------------- */

    if (
      message.type ===
      "ANALYZE_PROBLEM"
    ) {
      handleAnalyzeProblem(
        message,
        sender,
      )
        .then(sendResponse)
        .catch((error) => {
          console.error(
            "[AlgoForge] Analysis failed:",
            error,
          );

          sendResponse({
            success: false,

            message:
              error instanceof Error
                ? error.message
                : "Analysis failed.",
          });
        });

      return true;
    }

    /* ---------------------------------------------
       GITHUB STATUS
    --------------------------------------------- */

    if (
      message.type ===
      "GITHUB_STATUS"
    ) {
      getGitHubStatus()
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            success: false,

            connected: false,

            message:
              error instanceof Error
                ? error.message
                : "Unable to get GitHub status.",
          });
        });

      return true;
    }

    /* ---------------------------------------------
       OPEN GITHUB CONNECT
    --------------------------------------------- */

    if (
      message.type ===
      "OPEN_GITHUB_CONNECT"
    ) {
      openGitHubConnect()
        .then(() => {
          sendResponse({
            success: true,
          });
        })
        .catch((error) => {
          sendResponse({
            success: false,

            message:
              error instanceof Error
                ? error.message
                : "Unable to open GitHub connection.",
          });
        });

      return true;
    }

    /* ---------------------------------------------
       CREATE REVISION VAULT
    --------------------------------------------- */

    if (
      message.type ===
      "CREATE_REVISION_VAULT"
    ) {
      createRevisionVault(
        message.payload,
      )
        .then(sendResponse)
        .catch((error) => {
          console.error(
            "[AlgoForge] Revision Vault creation failed:",
            error,
          );

          sendResponse({
            success: false,

            message:
              error instanceof Error
                ? error.message
                : "Unable to create Revision Vault.",
          });
        });

      return true;
    }

    /* ---------------------------------------------
       UNKNOWN MESSAGE
    --------------------------------------------- */

    sendResponse({
      success: false,

      message:
        `Unknown message type: ${
          (message as any)?.type
        }`,
    });

    return false;
  },
);