importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDRCXXhgQrMNan2lK-5WN1f5fcXBdzHj2I',
  authDomain: 'courtside-kitchen.firebaseapp.com',
  projectId: 'courtside-kitchen',
  messagingSenderId: '1062967764463'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || '🚨 New Order Received!';
  const options = {
    body: payload.notification?.body || 'Check the seller dashboard for new orders.',
    icon: '/logo.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: 'new-order'
  };

  self.registration.showNotification(title, options);
});
