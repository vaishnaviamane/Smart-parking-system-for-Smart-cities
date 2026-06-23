const RATE_PER_HOUR = 20;
const SLOT_NUMBER = "01";

const statusLabels = {
  free: "FREE",
  booked: "BOOKED",
  occupied: "OCCUPIED"
};

const emptySlot = {
  status: "free",
  bookedBy: "",
  vehicleNumber: "",
  startTime: "",
  endTime: "",
  price: "",
  bookingId: ""
};

document.addEventListener("DOMContentLoaded", () => {
  // Create the Firebase node automatically for first-time users.
  seedDatabaseIfEmpty();

  // Wire up the page-specific realtime features.
  setupConnectionListener();
  setupBookingModal();
  setupDashboardPage();
  setupBookingPage();
  setupTicketPage();
});

function seedDatabaseIfEmpty() {
  slotRef.once("value").then((snapshot) => {
    if (!snapshot.exists()) {
      return slotRef.set(emptySlot);
    }
    return null;
  });
}

function setupConnectionListener() {
  const connectionLabel = document.getElementById("connectionState");
  if (!connectionLabel) return;

  database.ref(".info/connected").on("value", (snapshot) => {
    if (snapshot.val() === true) {
      connectionLabel.textContent = "Live Firebase connected";
      connectionLabel.classList.add("online");
    } else {
      connectionLabel.textContent = "Connecting to Firebase";
      connectionLabel.classList.remove("online");
    }
  });
}

function setupDashboardPage() {
  const parkingSlot = document.getElementById("parkingSlot");
  if (!parkingSlot) return;

  // Listen forever so every Firebase status change immediately updates the UI.
  slotRef.on("value", (snapshot) => {
    const data = normalizeSlot(snapshot.val());
    updateDashboard(data);
  });
}

function updateDashboard(data) {
  const status = normalizeStatus(data.status);
  const label = statusLabels[status];
  const timing = formatTiming(data.startTime, data.endTime);

  setText("slotStatusText", label);
  setText("summaryStatus", label);
  setText("liveStatus", label);
  setText("liveBookedBy", data.bookedBy || "None");
  setText("liveVehicle", data.vehicleNumber || "None");
  setText("liveTiming", timing || "Not booked");
  setText("livePrice", data.price ? `₹${data.price}` : "₹0");

  const subText = getSlotSubText(status, data);
  setText("slotSubText", subText);
  setText("summaryText", subText);

  setStateClass(document.getElementById("parkingSlot"), status);
  setStateClass(document.getElementById("summaryStatus"), status);

  const bookLinks = [document.getElementById("bookNowHero"), document.getElementById("bookNowSide")];
  bookLinks.forEach((link) => {
    if (!link) return;
    const canBook = status === "free";
    link.classList.toggle("disabled", !canBook);
    link.setAttribute("aria-disabled", String(!canBook));
    link.textContent = canBook ? "Book Now" : status === "booked" ? "Already Booked" : "Slot Occupied";
  });
}

function setupBookingModal() {
  const modal = document.getElementById("bookingModal");
  const closeButton = document.getElementById("closeBookingModal");
  const openButtons = [document.getElementById("bookNowHero"), document.getElementById("bookNowSide")];

  if (!modal) return;

  openButtons.forEach((button) => {
    if (!button) return;
    button.addEventListener("click", (event) => {
      if (button.getAttribute("aria-disabled") === "true") return;
      event.preventDefault();
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
    });
  });

  closeButton.addEventListener("click", closeBookingModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeBookingModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeBookingModal();
  });
}

function closeBookingModal() {
  const modal = document.getElementById("bookingModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function setupBookingPage() {
  const form = document.getElementById("bookingForm");
  if (!form) return;

  const startInput = document.getElementById("startTime");
  const endInput = document.getElementById("endTime");
  const submitButton = document.getElementById("confirmBookingBtn");
  const nowLocal = toLocalDateTimeValue(new Date(Date.now() + 5 * 60 * 1000));

  startInput.min = nowLocal;
  endInput.min = nowLocal;
  startInput.value = nowLocal;
  endInput.value = toLocalDateTimeValue(new Date(Date.now() + 65 * 60 * 1000));
  updatePricePreview();

  startInput.addEventListener("change", () => {
    endInput.min = startInput.value;
    updatePricePreview();
  });
  endInput.addEventListener("change", updatePricePreview);

  slotRef.on("value", (snapshot) => {
    const data = normalizeSlot(snapshot.val());
    const status = normalizeStatus(data.status);
    setText("bookingLiveStatus", statusLabels[status]);
    setText("bookingStatusText", statusLabels[status]);
    setStateClass(document.getElementById("bookingMiniSlot"), status);
    submitButton.disabled = status !== "free";
    submitButton.textContent = status === "free" ? "Confirm Booking" : "Slot Not Available";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const name = document.getElementById("userName").value.trim();
    const vehicleNumber = document.getElementById("vehicleNumber").value.trim().toUpperCase();
    const startTime = startInput.value;
    const endTime = endInput.value;
    const price = calculatePrice(startTime, endTime);

    if (!name || !vehicleNumber || !startTime || !endTime) {
      showMessage("Please fill all booking details.", "error");
      return;
    }

    if (price <= 0) {
      showMessage("End time must be later than start time.", "error");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Saving Booking...";

    try {
      const bookingId = createBookingId();
      let saved = false;
      const bookingData = {
        status: "booked",
        bookedBy: name,
        vehicleNumber,
        startTime,
        endTime,
        price: String(price),
        bookingId
      };

      // Transaction prevents two browser tabs from booking the same free slot.
      await slotRef.transaction((currentData) => {
        const current = normalizeSlot(currentData);
        if (normalizeStatus(current.status) !== "free") {
          return;
        }

        saved = true;
        return bookingData;
      });

      if (!saved) {
        showMessage("Slot was just taken. Please check the dashboard.", "error");
        return;
      }

      localStorage.setItem("smartParkLastBookingId", bookingId);
      localStorage.setItem("smartParkLastBooking", JSON.stringify(bookingData));
      window.location.href = `ticket.html?bookingId=${encodeURIComponent(bookingId)}`;
    } catch (error) {
      console.error(error);
      showMessage("Booking failed. Check Firebase config and try again.", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Confirm Booking";
    }
  });
}

function setupTicketPage() {
  const qrContainer = document.getElementById("qrcode");
  if (!qrContainer) return;

  const requestedId = new URLSearchParams(window.location.search).get("bookingId");
  const lastBookingId = requestedId || localStorage.getItem("smartParkLastBookingId") || "";
  const storedBooking = getStoredBooking();

  slotRef.on("value", (snapshot) => {
    const data = normalizeSlot(snapshot.val());

    if (!data.bookingId && storedBooking && (!lastBookingId || storedBooking.bookingId === lastBookingId)) {
      renderTicket(storedBooking);
      return;
    }

    if (lastBookingId && data.bookingId && data.bookingId !== lastBookingId) {
      if (storedBooking && storedBooking.bookingId === lastBookingId) {
        renderTicket(storedBooking);
        return;
      }

      setText("ticketBookingId", "Booking not found");
      qrContainer.innerHTML = "<span class=\"qr-message\">No booking data</span>";
      return;
    }

    renderTicket(data);
  });

  document.getElementById("downloadTicketBtn").addEventListener("click", () => {
    window.print();
  });
}

function renderTicket(data) {
  setText("ticketBookingId", data.bookingId || "-");
  setText("ticketName", data.bookedBy || "-");
  setText("ticketVehicle", data.vehicleNumber || "-");
  setText("ticketStart", formatDateTime(data.startTime));
  setText("ticketEnd", formatDateTime(data.endTime));
  setText("ticketAmount", data.price ? `₹${data.price}` : "₹0");

  const qrPayload = {
    bookingId: data.bookingId,
    name: data.bookedBy,
    vehicleNumber: data.vehicleNumber,
    bookingTime: `${formatDateTime(data.startTime)} to ${formatDateTime(data.endTime)}`,
    slotNumber: SLOT_NUMBER,
    amountPaid: `₹${data.price || 0}`
  };

  const qrContainer = document.getElementById("qrcode");
  qrContainer.innerHTML = "";

  if (!data.bookingId) {
    qrContainer.innerHTML = "<span class=\"qr-message\">Book a slot first</span>";
    return;
  }

  // qrcode.js turns the booking payload into a scannable ticket.
  if (window.QRCode && data.bookingId) {
    new QRCode(qrContainer, {
      text: JSON.stringify(qrPayload, null, 2),
      width: 220,
      height: 220,
      colorDark: "#07111f",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    qrContainer.innerHTML = "<span class=\"qr-message\">QR library not loaded</span>";
  }
}

function updatePricePreview() {
  const startTime = document.getElementById("startTime").value;
  const endTime = document.getElementById("endTime").value;
  const duration = calculateDurationHours(startTime, endTime);
  const price = calculatePrice(startTime, endTime);

  setText("durationText", duration > 0 ? `${duration.toFixed(2)} hr` : "0 hr");
  setText("priceText", `₹${price}`);
}

function calculateDurationHours(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const diffMs = end - start;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 0;
  return diffMs / (1000 * 60 * 60);
}

function calculatePrice(startTime, endTime) {
  const duration = calculateDurationHours(startTime, endTime);
  if (duration <= 0) return 0;
  return Math.ceil(duration * RATE_PER_HOUR);
}

function normalizeSlot(data) {
  return { ...emptySlot, ...(data || {}) };
}

function normalizeStatus(status) {
  const clean = String(status || "free").toLowerCase();
  return ["free", "booked", "occupied"].includes(clean) ? clean : "free";
}

function setStateClass(element, status) {
  if (!element) return;
  element.classList.remove("state-free", "state-booked", "state-occupied", "free", "booked", "occupied");
  element.classList.add(`state-${status}`);
  element.classList.add(status);
}

function getSlotSubText(status, data) {
  if (status === "occupied") return "Vehicle detected by ultrasonic sensor";
  if (status === "booked") return `Reserved ${formatTiming(data.startTime, data.endTime)}`;
  return "Slot is available now";
}

function formatTiming(startTime, endTime) {
  if (!startTime || !endTime) return "";
  return `${formatDateTime(startTime)} - ${formatDateTime(endTime)}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toLocalDateTimeValue(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createBookingId() {
  return `SP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function getStoredBooking() {
  try {
    const rawBooking = localStorage.getItem("smartParkLastBooking");
    return rawBooking ? JSON.parse(rawBooking) : null;
  } catch (error) {
    console.warn("Could not read stored booking", error);
    return null;
  }
}

function showMessage(message, type) {
  const element = document.getElementById("formMessage");
  if (!element) return;
  element.textContent = message;
  element.className = `form-message ${type}`;
}

function clearMessage() {
  showMessage("", "");
}

// Static QR mode: every ticket shows the same QR image from assets/qrcode.png.
// Booking details still update from Firebase/localStorage, but the QR never changes.
function renderTicket(data) {
  const ticketData = normalizeSlot(data);
  setText("ticketBookingId", ticketData.bookingId || "-");
  setText("ticketName", ticketData.bookedBy || "-");
  setText("ticketVehicle", ticketData.vehicleNumber || "-");
  setText("ticketStart", formatDateTime(ticketData.startTime));
  setText("ticketEnd", formatDateTime(ticketData.endTime));
  setText("ticketAmount", ticketData.price ? `Rs. ${ticketData.price}` : "Rs. 0");

  const qrContainer = document.getElementById("qrcode");
  if (!qrContainer) return;

  qrContainer.innerHTML = '<img id="staticQrCode" src="assets/qrcode.png" alt="Parking booking QR code">';
}
