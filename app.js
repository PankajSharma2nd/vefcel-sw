// Configuration
const SERVER_URL = 'https://vercel-server-1v1v.onrender.com';

// Log function
function log(message) {
    const logElement = document.getElementById('navigation-log');
    if (logElement) {
        const timestamp = new Date().toISOString();
        logElement.textContent = `${timestamp}: ${message}\n` + logElement.textContent;
        console.log(`${timestamp}: ${message}`);
    }
}

// Function to convert base64 string to Uint8Array
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Function to subscribe to push notifications
async function subscribeUserToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        log('Push notifications not supported');
        return;
    }
    
    try {
        // Get registration
        const registration = await navigator.serviceWorker.ready;
        log('Service worker is ready for push subscription');
        
        // Get VAPID public key from server
        let vapidPublicKey;
        
        try {
            // First try to fetch from server
            const response = await fetch(`${SERVER_URL}/vapidPublicKey`);
            const data = await response.json();
            vapidPublicKey = data.publicKey;
            log(`Received VAPID public key from server: ${vapidPublicKey.substring(0, 10)}...`);
        } catch (error) {
            // If server fetch fails, use hardcoded key
            vapidPublicKey = 'BG1NfrHDgwEIxe4ACqecfs0wB0T2v1DaTE45MgzZU4bovjnGKww8eSv-R8r68W_LmV3WTIzccK01C2FCwM55CLQ';
            log(`Using hardcoded VAPID public key: ${vapidPublicKey.substring(0, 10)}...`);
        }
        
        // Convert the key
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
        
        // Check for existing subscription
        let subscription = await registration.pushManager.getSubscription();
        
        if (subscription) {
            log('User already subscribed to push notifications');
        } else {
            // Subscribe the user
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey
            });
            
            log('User subscribed to push notifications');
        }
        
        // Send the subscription to the server
        await sendSubscriptionToServer(subscription);
        
        // Save subscription locally
        localStorage.setItem('pushSubscription', JSON.stringify(subscription));
        
        return subscription;
    } catch (error) {
        log(`Error subscribing to push: ${error}`);
    }
}

// Function to send the subscription to the server
async function sendSubscriptionToServer(subscription) {
    try {
        const response = await fetch(`${SERVER_URL}/subscribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                subscription: subscription,
                origin: window.location.origin,
                url: window.location.href
            })
        });
        
        const data = await response.json();
        log(`Subscription sent to server: ${JSON.stringify(data)}`);
    } catch (error) {
        log(`Error sending subscription to server: ${error}`);
    }
}

// Function to log navigation to the server
async function logNavigationToServer(url, referrer) {
    try {
        // Get the current subscription from local storage
        const subscriptionString = localStorage.getItem('pushSubscription');
        let subscriptionEndpoint = 'not-subscribed';
        
        if (subscriptionString) {
            const subscription = JSON.parse(subscriptionString);
            subscriptionEndpoint = subscription.endpoint;
        }
        
        const response = await fetch(`${SERVER_URL}/log-navigation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: url,
                referrer: referrer || document.referrer,
                userAgent: navigator.userAgent,
                subscriptionEndpoint: subscriptionEndpoint
            })
        });
        
        const data = await response.json();
        log(`Navigation logged to server: ${JSON.stringify(data)}`);
    } catch (error) {
        log(`Error logging navigation to server: ${error}`);
    }
}

// When the page loads
document.addEventListener('DOMContentLoaded', () => {
    const statusElement = document.getElementById('status');
    const permissionButton = document.getElementById('request-permission');
    
    // Log the current page load
    log(`Page loaded: ${window.location.href}`);
    logNavigationToServer(window.location.href, document.referrer);
    
    // Check if the browser supports service workers
    if ('serviceWorker' in navigator) {
        statusElement.textContent = 'Service Worker Status: Supported';
        
        // Register the service worker with the correct scope
        navigator.serviceWorker.register('/service-worker.js', {
            scope: '/' // Try to get maximum scope - Vercel allows this
        })
        .then(registration => {
            log('Service worker registered successfully');
            statusElement.textContent = 'Service Worker Status: Registered';
            
            // Log the scope that was granted
            log(`Scope granted: ${registration.scope}`);
            
            // Check if already subscribed to push
            registration.pushManager.getSubscription()
                .then(subscription => {
                    if (subscription) {
                        log('Already subscribed to push notifications');
                        localStorage.setItem('pushSubscription', JSON.stringify(subscription));
                    }
                });
        })
        .catch(error => {
            log(`Service worker registration failed: ${error}`);
            statusElement.textContent = 'Service Worker Status: Registration Failed';
        });
        
        // Listen for messages from the service worker
        navigator.serviceWorker.addEventListener('message', event => {
            log(`Message from service worker: ${JSON.stringify(event.data)}`);
            
            // If the message contains navigation data, log it to the server
            if (event.data.type === 'navigation' && event.data.url) {
                logNavigationToServer(event.data.url, event.data.referrer);
            }
        });
    } else {
        statusElement.textContent = 'Service Worker Status: Not Supported';
        log('Service workers are not supported in this browser');
    }
    
    // Request notification permission
    if (permissionButton) {
        permissionButton.addEventListener('click', () => {
            if ('Notification' in window) {
                Notification.requestPermission().then(permission => {
                    log(`Notification permission: ${permission}`);
                    if (permission === 'granted') {
                        // Try to subscribe to push if permission is granted
                        subscribeUserToPush();
                    }
                });
            } else {
                log('Notifications not supported in this browser');
            }
        });
    }
    
    // Add event listeners to track links to other Vercel apps
    document.addEventListener('click', (event) => {
        // Find if the click was on or inside an anchor tag
        let target = event.target;
        while (target && target.tagName !== 'A' && target.tagName !== 'BODY') {
            target = target.parentElement;
        }
        
        if (target && target.tagName === 'A') {
            const href = target.href;
            if (href && href.includes('vercel.app')) {
                log(`Vercel app link clicked: ${href}`);
                logNavigationToServer(href, window.location.href);
            }
        }
    });
});

// Log when the user is about to navigate away
window.addEventListener('beforeunload', () => {
    log(`Navigating away from: ${window.location.href}`);
});

// Attempt to track navigation
window.addEventListener('popstate', (event) => {
    log(`Navigation state changed: ${window.location.href}`);
    logNavigationToServer(window.location.href, 'popstate');
});
