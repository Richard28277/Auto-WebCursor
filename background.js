chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-side-panel") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.sidePanel.open({ windowId: tabs[0].windowId });
      }
    });
  }
});

// Function to extract and parse JSON from LLM response
function extractJSON(response) {
  const startMarker = '```json\n';
  const endMarker = '\n```';

  // Check if the response contains the JSON code block
  const start = response.indexOf(startMarker);
  if (start !== -1) {
    const end = response.indexOf(endMarker, start + startMarker.length);
    if (end !== -1) {
      const jsonContent = response.slice(start + startMarker.length, end);
      return JSON.parse(jsonContent);
    } else {
      throw new Error('Invalid JSON response format: missing end marker.');
    }
  } else {
    // Assume the entire response is a JSON string
    return JSON.parse(response);
  }
}

// Global flag to track if automation should continue
let shouldContinue = true;

// Main code execution
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'stopCommand') {
    shouldContinue = false;
    return;
  }
  
  if (request.action === 'executeCommand') {
    shouldContinue = true;
    chrome.tabs.query({ active: true, currentWindow: true }, async function(tabs) {
      try {
        const tabId = tabs[0].id;
        let currentHtml = await fetchPageHtml(tabId);
        currentHtml = currentHtml.slice(0, 3000);
        let stepCount = 0;
        const maxSteps = 15;

        // Get API configuration
        const apiConfig = await new Promise((resolve, reject) => {
          chrome.storage.local.get('apiConfig', (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError));
            } else {
              resolve(result.apiConfig ? result.apiConfig : null);
            }
          });
        });
        
        if (!apiConfig) {
          throw new Error('API configuration not set');
        }

        chrome.runtime.sendMessage({
          type: 'stepUpdate',
          step: 0,
          action: "Command received",
          message: "Generating automation steps.",
        });

        const goal = await fetchLLMResponse(
          "Formalize the user's request into specific, actionable steps for AI agent to automate web browsing. The user is starting from a search engine page. You must note specific actions, like input text, click on button, look for element, etc. Stop actions when goal is achieved. The avaliable actions are click and input. The goal is to " + request.command + ".",
          request.command
        );

        console.log("Formalized Goal: " + goal);
        let allSteps = [];

        while (stepCount < maxSteps && shouldContinue) {
          const prompt = `Given the current HTML content: ${currentHtml}. The goal is to ${goal}. The previous steps completed were: ${JSON.stringify(allSteps)}. Please respond with a JSON object containing "selector", "action", and "reason". If the action is "click", provide just the selector. If the action is "input", provide "selector" and "text" to input. The avaliable actions are click and input. The avaliable selectors are only those within the html. If the task is the final step, include a "task_completed" field with a value of true. Output the JSON. Do not use triple quotes. Do not repeat the last step if it returned error. selector: .gs-title is not allowed! Use herf when possible. Consider the action history, if failed to select an element, try a different element or action. Always make sure the selector is present in the html content.`;

          let llmResponse;
          try {
            llmResponse = await fetchLLMResponse(prompt, "Provide the output as a JSON object.");
            console.log("LLM Response: " + llmResponse);
          } catch (error) {
            throw new Error('Error fetching LLM response: ' + error.message);
          }

          let data;
          try {
            data = extractJSON(llmResponse);
          } catch (e) {
            throw new Error('Error parsing LLM response: ' + e.message);
          }

          if (!data.action || !data.selector) {
            throw new Error('Missing required fields in LLM response.');
          }

          chrome.runtime.sendMessage({
            type: 'stepUpdate',
            step: stepCount + 1,
            message: data.reason,
            action: data.action,
            selector: data.selector,
            text: data.text || null,
            html: currentHtml,
            llmResponse: llmResponse,
            prompt: prompt
          });

          console.log("Reason: " + data.reason);

          if (data.action === 'click') {
            const urlMatch = data.selector.match(/a\[href=['"](http[s]?:\/\/[^'"]+)['"]\]/);
            if (urlMatch) {
              chrome.tabs.update(tabId, { url: urlMatch[1] });
            } else {
              const clickResponse = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                function: clickElement,
                args: [data.selector]
              });
              if (!clickResponse || !clickResponse[0].result) {
                const lastError = allSteps[allSteps.length - 1];
                const isRepeatError = lastError && 
                  lastError.action === 'error' &&
                  lastError.selector === data.selector;
                
                const errorMessage = isRepeatError ?
                  `Failed to click element: ${data.selector}. Reminder: Do not repeat failed actions. ${data.selector} does not exist in the current HTML content.` :
                  `Failed to click element: ${data.selector}`;

                allSteps.push({
                  action: 'error',
                  selector: data.selector,
                  message: errorMessage
                });
                stepCount++;
                chrome.runtime.sendMessage({
                  type: 'stepUpdate',
                  step: stepCount + 1,
                  message: errorMessage,
                  action: 'error',
                  selector: data.selector,
                  html: currentHtml
                });
                continue;
              }
            }
          } else if (data.action === 'input') {
            if (!data.text) {
              throw new Error('Missing "text" field in LLM response for input action.');
            }
            const inputResponse = await chrome.scripting.executeScript({
              target: { tabId: tabId },
              function: inputText,
              args: [data.selector, data.text]
            });
            if (!inputResponse || !inputResponse[0].result) {
              const lastError = allSteps[allSteps.length - 1];
              const isRepeatError = lastError && 
                lastError.action === 'error' &&
                lastError.selector === data.selector;
              
              const errorMessage = isRepeatError ?
                `Failed to input text to: ${data.selector}. Reminder: Do not repeat failed actions. ${data.selector} does not exist in the current HTML content.` :
                `Failed to input text to: ${data.selector}`;

              allSteps.push({
                action: 'error',
                selector: data.selector,
                message: errorMessage
              });
              stepCount++;
              chrome.runtime.sendMessage({
                type: 'stepUpdate',
                step: stepCount + 1,
                message: errorMessage,
                action: 'error',
                selector: data.selector,
                html: currentHtml
              });
              continue;
            }
          } else {
            throw new Error('Invalid action specified by LLM.');
          }

          if (data.task_completed) {
            console.log('Task completed successfully.');
            chrome.runtime.sendMessage({
              type: 'finalUpdate',
              message: 'Task completed successfully.',
              action: data.action,
              selector: data.selector,
              text: data.text || null,
              html: currentHtml,
              llmResponse: llmResponse,
              prompt: prompt
            });
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
          currentHtml = (await fetchPageHtml(tabId)).slice(0, 3000);
          stepCount++;

          allSteps.push({
            action: data.action,
            selector: data.selector,
            text: data.text || null,
            reason: data.reason
          });
        }

        if (!shouldContinue) {
          chrome.runtime.sendMessage({
            type: 'finalUpdate',
            message: 'Automation stopped by user request.',
            html: currentHtml
          });
        } else if (stepCount >= maxSteps) {
          chrome.runtime.sendMessage({
            type: 'finalUpdate',
            message: 'Maximum steps reached. Goal may not be fully achieved.',
            html: currentHtml,
            llmResponse: llmResponse
          });
        } 
      } catch (error) {
        chrome.runtime.sendMessage({
          type: 'error',
          message: 'Error: ' + error.message,
          html: '',
          llmResponse: ''
        });
      }
    });
    return true;
  }
});

async function fetchPageHtml(tabId) {
  const htmlResponse = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    function: () => {
      const visibleClickableElements = Array.from(
        document.querySelectorAll('a, button, input, textarea, select')
      )
        .filter(el => {
          const style = window.getComputedStyle(el);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            !el.hasAttribute('hidden')
          );
        })
        .map(el => {
          const tagName = el.tagName.toLowerCase();
          const attributes = [];

          if (el.id) attributes.push(`id="${el.id}"`);
          if (el.classList.length) attributes.push(`class="${el.classList.value}"`);
          if (el.hasAttribute('jsname')) attributes.push(`jsname="${el.getAttribute('jsname')}"`);
          if (tagName === 'a' && el.href) attributes.push(`href="${el.href}"`);
          if (tagName === 'input' && el.type) attributes.push(`type="${el.type}"`);
          if ((tagName === 'input' || tagName === 'textarea') && el.value) {
            attributes.push(`value="${el.value}"`);
          }
          if (tagName === 'select' && el.value) {
            attributes.push(`selected="${el.value}"`);
          }
          if (el.hasAttribute('aria-label')) {
            attributes.push(`aria-label="${el.getAttribute('aria-label')}"`);
          }

          const text = el.innerText.trim();
          const attributesString = attributes.length ? ` ${attributes.join(' ')}` : '';
          return `<${tagName}${attributesString}>${text}</${tagName}>`;
        })
        .join('');

      const cleanedDoc = document.implementation.createHTMLDocument('');
      cleanedDoc.body.innerHTML = visibleClickableElements;
      return cleanedDoc.documentElement.outerHTML;
    }
  });

  if (htmlResponse && htmlResponse[0].result) {
    return htmlResponse[0].result;
  } else {
    throw new Error('Failed to fetch page HTML.');
  }
}

async function fetchLLMResponse(prompt, text) {
  const apiConfig = await new Promise((resolve, reject) => {
    chrome.storage.local.get('apiConfig', (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError));
      } else {
        resolve(result.apiConfig ? result.apiConfig : null);
      }
    });
  });
  
  if (!apiConfig) {
    throw new Error('API configuration not set');
  }

  const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiConfig.apiKey}`
    },
    body: JSON.stringify({
      model: apiConfig.model,
      messages: [
        {
          role: "system",
          content: prompt
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.7,
      max_tokens: 1000
    }),
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

function clickElement(selector) {
  const element = document.querySelector(selector);
  if (element) {
    const originalBorder = window.getComputedStyle(element, null).getPropertyValue('border');
    element.style.border = "3px solid red";
    setTimeout(() => {
      element.style.border = originalBorder;
      element.click();
    }, 1000);
    return true;
  }
  return false;
}

function inputText(selector, text) {
  const element = document.querySelector(selector);
  if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT')) {
    const originalBorder = window.getComputedStyle(element, null).getPropertyValue('border');
    element.style.border = "3px solid red";
    setTimeout(() => {
      element.style.border = originalBorder;
      if (element.tagName === 'SELECT') {
        element.value = text;
      } else {
        element.value = text;
        const event = new Event('input', { bubbles: true });
        element.dispatchEvent(event);
      }
    }, 1000);
    return true;
  }
  return false;
}
