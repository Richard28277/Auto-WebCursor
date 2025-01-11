// Function to hash a password using SHA-256
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// Add login handler
document.getElementById('loginButton').addEventListener('click', async function () {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  
  if (!email || !password) {
    document.getElementById('loginStatus').textContent = 'Please enter both email and password';
    return;
  }

  // Hash the password on the client side
  const hashedPassword = await hashPassword(password);
  // Store encrypted credentials in chrome.storage.local
  chrome.storage.local.set({ credentials: { email: email, password: hashedPassword } }, function() {
    console.log('Credentials saved to chrome.storage.local');
  });

  // Verify login with API
  try {
    const response = await fetch('https://seekso.pythonanywhere.com/api/checklogin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password: hashedPassword })
    });
    console.log(response);
    if (!response.ok) {
      throw new Error('Login failed');
    }

    const data = await response.json();
    console.log(data);
  if (data.status === 'accept') {
      document.getElementById('loginStatus').textContent = 'Login successful!';
      document.getElementById('loginSection').style.display = 'none';
      document.getElementById('logoutButton').style.display = 'block';
      document.getElementById('commandSection').style.display = 'block';
      // Update usage display from login response
      if (data.usage !== undefined) {
        document.getElementById('usageDisplay').textContent = `Daily usage: ${data.usage}/20`;
      }
    } else {
      document.getElementById('loginStatus').textContent = 'Invalid credentials';
    }
  } catch (error) {
    document.getElementById('loginStatus').textContent = 'Login failed. Please try again.';
  }
});

// Add event listeners for login/signup toggle
document.getElementById('showSignupButton').addEventListener('click', function() {
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('signupSection').style.display = 'block';
});

document.getElementById('showLoginButton').addEventListener('click', function() {
  document.getElementById('signupSection').style.display = 'none';
  document.getElementById('loginSection').style.display = 'block';
});

// Add sign up handler
document.getElementById('signupButton').addEventListener('click', async function() {
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const confirmPassword = document.getElementById('signupConfirmPassword').value;
  const status = document.getElementById('signupStatus');

  // Clear previous status
  status.textContent = '';
  status.style.color = '#666';

  // Validate inputs
  if (!email || !password || !confirmPassword) {
    status.textContent = 'Please fill in all fields';
    status.style.color = '#dc3545';
    return;
  }

  if (password !== confirmPassword) {
    status.textContent = 'Passwords do not match';
    status.style.color = '#dc3545';
    return;
  }

  try {
    // Hash password before sending
    const hashedPassword = await window.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(password)
    ).then(hash => {
      return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    });

    const response = await fetch('https://seekso.pythonanywhere.com/api/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        password: hashedPassword
      })
    });

    const data = await response.json();
    if (response.ok) {
      status.textContent = 'Account created successfully!';
      status.style.color = '#28a745';
      // Show login form after successful signup
      document.getElementById('showLoginButton').click();
    } else {
      status.textContent = data.error || 'Registration failed';
      status.style.color = '#dc3545';
    }
  } catch (error) {
    status.textContent = 'Network error. Please try again.';
    status.style.color = '#dc3545';
    console.error('Signup error:', error);
  }
});

// Check for stored credentials on page load
document.addEventListener('DOMContentLoaded', async function() {
  // Initialize usage display
  const usageDiv = document.createElement('div');
  usageDiv.id = 'usageDisplay';
  usageDiv.style.position = 'absolute';
  usageDiv.style.top = '10px';
  usageDiv.style.left = '10px';
  usageDiv.style.padding = '5px 10px';
  usageDiv.style.backgroundColor = '#f0f0f0';
  usageDiv.style.borderRadius = '4px';
  usageDiv.style.fontWeight = 'bold';
  usageDiv.textContent = 'Daily usage limit: 20';
  document.body.appendChild(usageDiv);

  // Add logout button
  const logoutButton = document.createElement('button');
  logoutButton.id = 'logoutButton';
  logoutButton.textContent = 'Logout';
  logoutButton.style.position = 'fixed';
  logoutButton.style.top = '10px';
  logoutButton.style.right = '10px';
  logoutButton.style.padding = '5px 10px';
  logoutButton.style.backgroundColor = 'grey'; // More visible color
  logoutButton.style.color = '#fff'; // White text color
  logoutButton.style.border = '1px solidrgb(95, 95, 95)';
  logoutButton.style.borderRadius = '4px';
  logoutButton.style.cursor = 'pointer';
  logoutButton.style.width = 'auto'; // Ensure it only takes up necessary space
  document.body.appendChild(logoutButton);

  // Add logout handler
  logoutButton.addEventListener('click', function() {
    console.log('Logging out');
    chrome.storage.local.remove('credentials', function() {
      // Reset UI to login state
      document.getElementById('loginSection').style.display = 'block';
      document.getElementById('commandSection').style.display = 'none';
      document.getElementById('loginStatus').textContent = '';
      document.getElementById('logoutButton').style.display = 'none';
    });
  });


  // Check for stored credentials
  const credentials = await new Promise((resolve) => {
    chrome.storage.local.get('credentials', (result) => {
      resolve(result.credentials || null);
    });
  });

  if (credentials) {
    // Auto-login with stored credentials
    try {
      const response = await fetch('https://seekso.pythonanywhere.com/api/checklogin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials)
      });

      if (!response.ok) {
        throw new Error('Auto-login failed');
      }

      const data = await response.json();
      if (data.status === 'accept') {
        document.getElementById('loginStatus').textContent = 'Auto-login successful!';
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('logoutButton').style.display = 'block';
        document.getElementById('commandSection').style.display = 'block';
        if (data.usage !== undefined) {
          document.getElementById('usageDisplay').textContent = `Daily usage: ${data.usage}/20`;
        }
      }
    } catch (error) {
      console.error('Auto-login error:', error);
      // Show login form if auto-login fails
      document.getElementById('loginSection').style.display = 'block';
      document.getElementById('commandSection').style.display = 'none';
    }
  }
});

// Add event listeners to buttons
document.getElementById('executeButton').addEventListener('click', function () {
  const command = document.getElementById('userCommand').value;

  // Clear previous timeline
  document.getElementById('timeline').innerHTML = '';

  // Show stop button and hide execute button
  document.getElementById('stopButton').style.display = 'block';
  document.getElementById('executeButton').style.display = 'none';

  // Send the command to the background script
  chrome.runtime.sendMessage({ action: 'executeCommand', command: command });
});

// Add stop button handler
document.getElementById('stopButton').addEventListener('click', function () {
  chrome.runtime.sendMessage({ action: 'stopCommand' });
});

// Update usage display
function updateUsageDisplay(usage) {
  const usageDisplay = document.getElementById('usageDisplay');
  if (usageDisplay) {
    usageDisplay.textContent = `Daily usage: ${usage}/20`;
  }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle usage updates from background
  if (message.type === 'usageUpdate') {
    updateUsageDisplay(message.usage);
    return;
  }
  const timeline = document.getElementById('timeline');

  if (message.type === 'stepUpdate') {
    // Create a new step in the timeline
    const stepDiv = document.createElement('div');
    stepDiv.className = 'step';
    stepDiv.innerHTML = `
      <h3>Step ${message.step}: ${message.action}</h3>
      <p>${message.message}</p>
    `;

    // Append the step to the timeline
    timeline.appendChild(stepDiv);
  } else if (message.type === 'finalUpdate') {
    // Hide stop button and show execute button when automation completes
    document.getElementById('stopButton').style.display = 'none';
    document.getElementById('executeButton').style.display = 'block';
    // Create a final step in the timeline
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

    // Add expand/collapse functionality
    const expandButton = finalStepDiv.querySelector('.expand-button');
    const outputSection = finalStepDiv.querySelector('.output');
    expandButton.addEventListener('click', () => {
      if (outputSection.style.display === 'none' || outputSection.style.display === '') {
        outputSection.style.display = 'block';
        expandButton.textContent = 'Hide Details';
      } else {
        outputSection.style.display = 'none';
        expandButton.textContent = 'Show Details';
      }
    });

    // Append the final step to the timeline
    timeline.appendChild(finalStepDiv);
  } else if (message.type === 'error') {
    // Hide stop button and show execute button on error
    document.getElementById('stopButton').style.display = 'none';
    document.getElementById('executeButton').style.display = 'block';
    // Create an error step in the timeline
    const errorStepDiv = document.createElement('div');
    errorStepDiv.className = 'step';
    errorStepDiv.innerHTML = `
      <h3>Error</h3>
      <p>${message.message}</p>
    `;

    // Append the error step to the timeline
    timeline.appendChild(errorStepDiv);
  }
});
