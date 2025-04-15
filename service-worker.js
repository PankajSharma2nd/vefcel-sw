// Service Worker for Vercel App Tracking Experiment
const VERSION = 'v1';
const SERVER_URL = 'https://vercel-server-1v1v.onrender.com';

// Log function for the service worker
function swLog(message) {
    console.log(`[Service Worker ${VERSION}] ${message}`);
    
    // Try to send the log to all clients
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'log',
                message: message
            });
        });
    });
}

// Function to log navigation to server
async function logNavigationToServer(url, referrer) {
    try {
        // Get subscription if available
        const subscriptionData = await self.registration.pushManager.getSubscription();
        const subscriptionEndpoint = subscriptionData ? subscriptionData.endpoint : 'not-available-in-sw';
        
        const response = await fetch(`${SERVER_URL}/log-navigation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: url,
                referrer: referrer || 'unknown',
                userAgent: 'service-worker',
                subscriptionEndpoint: subscriptionEndpoint,
                timestamp: new Date().toISOString()
            })
        });
        
        const result = await response.json();
        swLog(`Navigation logged to server: ${JSON.stringify(result)}`);
        return result;
    } catch (error) {
        swLog(`Error logging navigation to server: ${error}`);
        return { error: error.message };
    }
}

// Install event - cache static resources
self.addEventListener('install', event => {
    swLog('Installing Service Worker');
    
    event.waitUntil(
        caches.open(`static-cache-${VERSION}`)
            .then(cache => {
                return cache.addAll([
                    '/',
                    '/index.html',
                    '/page2.html',
                    '/style.css',
                    '/app.js'
                ]);
            })
            .then(() => {
                swLog('Static resources cached');
                return self.skipWaiting();
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    swLog('Activating Service Worker');
    
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.filter(cacheName => {
                        return cacheName.startsWith('static-cache-') && 
                               cacheName !== `static-cache-${VERSION}`;
                    }).map(cacheName => {
                        swLog(`Deleting old cache: ${cacheName}`);
                        return caches.delete(cacheName);
                    })
                );
            })
            .then(() => {
                swLog('Service Worker activated');
                return self.clients.claim();
            })
    );
});

// Fetch event - try to serve from cache first and track navigation
self.addEventListener('fetch', event => {
    // Log the fetch event
    const url = new URL(event.request.url);
    
    // Skip logging API requests to avoid circular logging
    if (!url.pathname.includes('/log-navigation') && !url.pathname.includes('/subscribe')) {
        swLog(`Fetch event: ${url.pathname}`);
    }
    
    // For this experiment, try to track all vercel.app requests
    if (url.hostname.endsWith('vercel.app') && 
        event.request.method === 'GET' && 
        event.request.mode === 'navigate') {
        
        swLog(`Vercel app navigation detected: ${event.request.url}`);
        
        // Try to notify clients about this navigation
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'navigation',
                    url: event.request.url,
                    referrer: event.request.referrer || 'unknown'
                });
            });
        });
        
        // Try to log to server, but don't block the fetch event
        logNavigationToServer(event.request.url, event.request.referrer);
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                
                return fetch(event.request)
                    .then(networkResponse => {
                        // Don't cache API responses or non-GET requests
                        if (event.request.method !== 'GET' || 
                            url.pathname.includes('/api/') ||
                            url.hostname === new URL(SERVER_URL).hostname) {
                            return networkResponse;
                        }
                        
                        // Clone the response as it can only be consumed once
                        const responseClone = networkResponse.clone();
                        
                        // Cache the response for future use
                        caches.open(`static-cache-${VERSION}`)
                            .then(cache => {
                                cache.put(event.request, responseClone);
                            });
                            
                        return networkResponse;
                    });
            })
    );
});

// Push event - handle push notifications
self.addEventListener('push', event => {
    swLog('Push event received');
    
    let notificationData = {};
    
    try {
        if (event.data) {
            notificationData = event.data.json();
            swLog(`Push data: ${JSON.stringify(notificationData)}`);
        }
    } catch (error) {
        swLog(`Error parsing push data: ${error}`);
    }
    
    const title = notificationData.title || 'Navigation Tracker';
    const options = {
        body: notificationData.body || 'A new event was detected.',
        icon: notificationData.icon || '/icon-192x192.png',
        badge: notificationData.badge || '/badge.png',
        tag: notificationData.tag || 'default',
        data: {
            url: notificationData.url || '/',
            timestamp: notificationData.timestamp || new Date().toISOString()
        }
    };
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Notification click event
self.addEventListener('notificationclick', event => {
    swLog(`Notification clicked: ${event.notification.tag}`);
    
    // Close the notification
    event.notification.close();
    
    // Navigate to the URL from the notification data
    const urlToOpen = event.notification.data.url || '/';
    
    event.waitUntil(
        self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        })
        .then(clients => {
            // Check if there is already a window/tab open with the target URL
            for (let client of clients) {
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            // If not, open a new window/tab
            if (self.clients.openWindow) {
                return self.clients.openWindow(urlToOpen);
            }
        })
    );
});

// Message event - handle messages from the client
self.addEventListener('message', event => {
    swLog(`Message received from client: ${JSON.stringify(event.data)}`);
    
    // If the message requests navigation logging
    if (event.data.type === 'log-navigation' && event.data.url) {
        logNavigationToServer(event.data.url, event.data.referrer);
    }
});

// Listen for client state changes
self.addEventListener('clientschanged', event => {
    swLog('Clients changed event detected');
    
    self.clients.matchAll()
        .then(clients => {
            swLog(`Number of clients: ${clients.length}`);
            clients.forEach(client => {
                swLog(`Client URL: ${client.url}`);
            });
        });
});
