// Firebase web configuration for the browser CDN scripts used in the HTML files.
// This project uses Firebase v8 compat scripts:
// firebase-app.js and firebase-database.js
const firebaseConfig = {
  apiKey: "AIzaSyCoD5W95FFD_6mepYfWms9tv_Nay209-Uo",
  authDomain: "smart-park-db-94758.firebaseapp.com",
  databaseURL: "https://smart-park-db-94758-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-park-db-94758",
  storageBucket: "smart-park-db-94758.firebasestorage.app",
  messagingSenderId: "864593092756",
  appId: "1:864593092756:web:35aff0c6a2669ddbb5d481"
};

// Initialize Firebase only once. This avoids duplicate-app errors during reloads.
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const database = firebase.database();
const slotRef = database.ref("parkingSlot");
