(function () {
  'use strict';

  var body = document.body;
  var pixelId = body.getAttribute('data-pixel') || '';

  function getConsent() {
    var m = document.cookie.match(/(?:^|; )cookie_consent=(accepted|declined)/);
    return m ? m[1] : null;
  }
  function setConsent(v) {
    document.cookie = 'cookie_consent=' + v + '; Max-Age=31536000; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }

  // The Meta Pixel is only loaded after the visitor clicks Accept.
  function loadPixel() {
    if (!pixelId || window.fbq) return;
    var n = (window.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
    if (body.getAttribute('data-track') === 'lead') window.fbq('track', 'Lead');
  }

  var banner = document.getElementById('cookie-banner');
  var consent = getConsent();
  if (consent === 'accepted') loadPixel();
  if (!consent && banner) banner.hidden = false;

  var acc = document.getElementById('cookie-accept');
  var dec = document.getElementById('cookie-decline');
  if (acc) acc.addEventListener('click', function () { setConsent('accepted'); banner.hidden = true; loadPixel(); });
  if (dec) dec.addEventListener('click', function () { setConsent('declined'); banner.hidden = true; });

  // Hide the mobile "reserve" bar while the form is on screen.
  var bar = document.getElementById('mobile-cta');
  var form = document.getElementById('register');
  if (bar && form && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      bar.classList.toggle('hide', entries[0].isIntersecting);
    }, { threshold: 0.15 }).observe(form);
  }

  // Friendly phone formatting as the visitor types.
  var phone = document.getElementById('phone');
  if (phone) {
    phone.addEventListener('blur', function () {
      var d = phone.value.replace(/\D/g, '');
      if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
      if (d.length === 10) phone.value = '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    });
  }

  // Prevent double submits.
  document.querySelectorAll('form[data-once]').forEach(function (f) {
    f.addEventListener('submit', function () {
      var b = f.querySelector('button[type=submit]');
      if (b) { b.disabled = true; b.textContent = 'Please wait...'; }
    });
  });

  // Auto-submit selects and confirm dangerous actions (no inline handlers, so the CSP can stay strict).
  document.querySelectorAll('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () { el.form.submit(); });
  });
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Copy-to-clipboard buttons in the admin area.
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var el = document.getElementById(btn.getAttribute('data-copy'));
      if (el && navigator.clipboard) navigator.clipboard.writeText(el.textContent.trim()).then(function () { btn.textContent = 'Copied'; });
    });
  });
})();
