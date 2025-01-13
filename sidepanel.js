// API Configuration
const apiProviders = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'o1-preview', 'o1-mini', 'gpt-4o-mini']
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat']
  },
  claude: {
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307']
  }
};

// Initialize UI
document.addEventListener('DOMContentLoaded', function() {
  // Populate provider dropdown
  const providerSelect = document.getElementById('apiProvider');
  providerSelect.addEventListener('change', updateModelOptions);
  
  // Initialize model dropdown
  updateModelOptions();
  
  // Load saved configuration
  loadConfig();
  
  // Add settings icon handler
  document.getElementById('settingsIcon').addEventListener('click', toggleSettings);
});

// Update model options based on selected provider
function updateModelOptions() {
  const provider = document.getElementById('apiProvider').value;
  const modelSelect = document.getElementById('apiModel');
  
  // Clear existing options
  modelSelect.innerHTML = '';
  
  // Add new options
  apiProviders[provider].models.forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  });
}

// Save API configuration
document.getElementById('saveConfig').addEventListener('click', function() {
  const provider = document.getElementById('apiProvider').value;
  const model = document.getElementById('apiModel').value;
  const apiKey = document.getElementById('apiKey').value;
  
  if (!apiKey) {
    document.getElementById('configStatus').textContent = 'Please enter your API key';
    return;
  }
  
  const config = {
    provider: provider,
    model: model,
    apiKey: apiKey,
    baseUrl: apiProviders[provider].baseUrl
  };
  
  chrome.storage.local.set({ apiConfig: config }, function() {
    document.getElementById('configStatus').textContent = 'Configuration saved!';
    document.getElementById('apiConfigSection').style.display = 'none';
    document.getElementById('commandSection').style.display = 'block';
  });
});

// Load saved configuration
function loadConfig() {
  chrome.storage.local.get('apiConfig', function(result) {
    if (result.apiConfig) {
      document.getElementById('apiProvider').value = result.apiConfig.provider;
      updateModelOptions();
      document.getElementById('apiModel').value = result.apiConfig.model;
      document.getElementById('apiKey').value = result.apiConfig.apiKey;
      document.getElementById('apiConfigSection').style.display = 'none';
      document.getElementById('commandSection').style.display = 'block';
    }
  });
}

// Toggle settings visibility
function toggleSettings() {
  const configSection = document.getElementById('apiConfigSection');
  const commandSection = document.getElementById('commandSection');
  
  if (configSection.style.display === 'none') {
    configSection.style.display = 'block';
    commandSection.style.display = 'none';
  } else {
    configSection.style.display = 'none';
    commandSection.style.display = 'block';
  }
}

// Command execution handlers
document.getElementById('executeButton').addEventListener('click', function() {
  const command = document.getElementById('userCommand').value;
  
  // Clear timeline
  document.getElementById('timeline').innerHTML = '';
  
  // Show stop button
  document.getElementById('stopButton').style.display = 'block';
  document.getElementById('executeButton').style.display = 'none';
  
  // Send command to background
  chrome.runtime.sendMessage({ action: 'executeCommand', command: command });
});

document.getElementById('stopButton').addEventListener('click', function() {
  chrome.runtime.sendMessage({ action: 'stopCommand' });
});

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const timeline = document.getElementById('timeline');
  
  if (message.type === 'stepUpdate') {
    const stepDiv = document.createElement('div');
    stepDiv.className = 'step';
    stepDiv.innerHTML = `
      <h3>Step ${message.step}: ${message.action}</h3>
      <p>${message.message}</p>
    `;
    timeline.appendChild(stepDiv);
  }
  else if (message.type === 'finalUpdate') {
    document.getElementById('stopButton').style.display = 'none';
    document.getElementById('executeButton').style.display = 'block';
    
    const finalStepDiv = document.createElement('div');
    finalStepDiv.className = 'step';
    finalStepDiv.innerHTML = `
      <h3>Final Result</h3>
      <p>${message.message}</p>
      <button class="expand-button">Show Details</button>
      <div class="output">
        <h4>Prompt</h4>
        <textarea readonly>${message.prompt}</textarea>
        <h4>HTML</h4>
        <textarea readonly>${message.html}</textarea>
        <h4>LLM Response</h4>
        <textarea readonly>${message.llmResponse}</textarea>
      </div>
    `;
    
    finalStepDiv.querySelector('.expand-button').addEventListener('click', () => {
      const output = finalStepDiv.querySelector('.output');
      output.style.display = output.style.display === 'none' ? 'block' : 'none';
      finalStepDiv.querySelector('.expand-button').textContent = 
        output.style.display === 'block' ? 'Hide Details' : 'Show Details';
    });
    
    timeline.appendChild(finalStepDiv);
  }
  else if (message.type === 'error') {
    document.getElementById('stopButton').style.display = 'none';
    document.getElementById('executeButton').style.display = 'block';
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'step';
    errorDiv.innerHTML = `
      <h3>Error</h3>
      <p>${message.message}</p>
    `;
    timeline.appendChild(errorDiv);
  }
});
