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
    shouldContinue = true; // Reset flag when starting new command
    chrome.tabs.query({ active: true, currentWindow: true }, async function(tabs) {
      try {
        const tabId = tabs[0].id;
        let currentHtml = await fetchPageHtml(tabId);
        currentHtml = currentHtml.slice(0, 3000);
        let stepCount = 0;
        const maxSteps = 15;
        // Formalize the user's request using LLM
        const credentials = await new Promise((resolve, reject) => {
          chrome.storage.local.get('credentials', (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError));
            } else {
              resolve(result.credentials ? result.credentials : null);
            }
          });
        });
        
        if (!credentials) {
          throw new Error('User not logged in');
        }
        // Check usage limit
        const usageResponse = await fetch("https://seekso.pythonanywhere.com/api/webcursor-usage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Basic ${btoa(`${credentials.email}:${credentials.password}`)}`
          }
        });

        if (!usageResponse.ok) {
          throw new Error('Failed to check usage limit');
        }

        const usageData = await usageResponse.json();
        console.log('Usage data:', usageData);
        chrome.runtime.sendMessage({
          type: 'usageUpdate',
          usage: usageData.usage
        });
        if (usageData.usage > 20) {
          chrome.runtime.sendMessage({
            type: 'error',
            message: 'You have reached the usage limit today. Please try again tomorrow.',
            html: '',
            llmResponse: ''
          });
          return;
        }

        const goal = await fetchLLMResponse(prompt="Formalize the user's request. Use chronological order and logical statements. You are starting in a search engine page. The first step must be to search for user request.", text=request.command);
        console.log("Formalized Goal: " + goal);
        let allSteps = [];

        while (stepCount < maxSteps && shouldContinue) {
          // Generate the next step using the LLM
          const prompt = `Given the current HTML content: ${currentHtml}. The goal is to ${goal}. The previous steps completed were: ${JSON.stringify(allSteps)}. Please respond with a JSON object containing "selector", "action", and "reason". If the action is "click", provide just the selector. If the action is "input", provide "selector" and "text" to input. If the task is the final step, include a "task_completed" field with a value of true. Output the JSON. Do not use triple quotes. Do not repeat the last step. selector: .gs-title is not allowed! Use herf when possible. Consider the action history, if repeated failures to select an element, try a different element or action.`;
          let llmResponse;
          try {
            llmResponse = await fetchLLMResponse(prompt, "Provide the output as a JSON object.");
            console.log("LLM Response: " + llmResponse);
          } catch (error) {
            throw new Error('Error fetching LLM response: ' + error.message);
          }
          // Extract and parse JSON from LLM response
          let data;
          try {
            data = extractJSON(llmResponse);
          } catch (e) {
            throw new Error('Error parsing LLM response: ' + e.message);
          }

          // Validate the JSON object
          if (!data.action || !data.selector) {
            throw new Error('Missing required fields in LLM response.');
          }

          // Log the reasoning and action to the UI
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

          // Execute the action
          if (data.action === 'click') {
            // Check if the selector is a link with a full URL
            const urlMatch = data.selector.match(/a\[href=['"](http[s]?:\/\/[^'"]+)['"]\]/);
            if (urlMatch) {
              // Redirect to the URL
              chrome.tabs.update(tabId, { url: urlMatch[1] });
            } else {
              // Perform the click action
              const clickResponse = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                function: clickElement,
                args: [data.selector]
              });
              if (!clickResponse || !clickResponse[0].result) {
                // Add error to history and continue
                allSteps.push({
                  action: 'error',
                  selector: data.selector,
                  message: `Failed to click element: ${data.selector}`
                });
                stepCount++;
                chrome.runtime.sendMessage({
                  type: 'stepUpdate',
                  step: stepCount + 1,
                  message: `Failed to click element: ${data.selector}`,
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
              // Add error to history and continue
              allSteps.push({
                action: 'error',
                selector: data.selector,
                message: `Failed to input text to: ${data.selector}`
              });
              stepCount++;
              chrome.runtime.sendMessage({
                type: 'stepUpdate',
                step: stepCount + 1,
                message: `Failed to input text to: ${data.selector}`,
                action: 'error',
                selector: data.selector,
                html: currentHtml
              });
              continue;
            }
          } else {
            throw new Error('Invalid action specified by LLM.');
          }

          // Check if the task is completed
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

          // Wait for 3 seconds before updating the current HTML
          await new Promise((resolve) => setTimeout(resolve, 2000));
          // Update the current HTML after the action
          currentHtml = (await fetchPageHtml(tabId)).slice(0, 3000);
          stepCount++;

          // Update the allSteps array with the current step
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
      // Select visible clickable elements
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

          const text = el.innerText.trim(); // Use innerText for better text handling
          const attributesString = attributes.length ? ` ${attributes.join(' ')}` : '';
          return `<${tagName}${attributesString}>${text}</${tagName}>`;
        })
        .join('');

      // Create a new document fragment with the cleaned elements
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
  // Get stored credentials
  const credentials = await new Promise((resolve, reject) => {
    chrome.storage.local.get('credentials', (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError));
      } else {
        resolve(result.credentials ? result.credentials : null);
      }
    });
  });
  
  if (!credentials) {
    throw new Error('User not logged in');
  }

  const email = credentials.email;
  const password = credentials.password;

  const response = await fetch("https://seekso.pythonanywhere.com/api/generate-move", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${btoa(`${email}:${password}`)}`
    },
    body: JSON.stringify({ text: text.trimStart(), prompt }),
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data.response;
}

function clickElement(selector) {
  const element = document.querySelector(selector);
  if (element) {
    // Save original border style
    const originalBorder = window.getComputedStyle(element, null).getPropertyValue('border');
    // Add green border
    element.style.border = "3px solid red";
    // Wait for 1 second
    setTimeout(() => {
      // Restore original border
      element.style.border = originalBorder;
      // Perform the click
      element.click();
    }, 1000);
    return true;
  } else {
    return false;
  }
}

function inputText(selector, text) {
  const element = document.querySelector(selector);
  if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT')) {
    // Save original border style
    const originalBorder = window.getComputedStyle(element, null).getPropertyValue('border');
    // Add green border
    element.style.border = "3px solid red";
    // Wait for 1 second
    setTimeout(() => {
      // Restore original border
      element.style.border = originalBorder;
      // Perform the input action
      if (element.tagName === 'SELECT') {
        element.value = text;
      } else {
        element.value = text;
        // Trigger input event for better compatibility
        const event = new Event('input', { bubbles: true });
        element.dispatchEvent(event);
      }
    }, 1000);
    return true;
  } else {
    return false;
  }
}
