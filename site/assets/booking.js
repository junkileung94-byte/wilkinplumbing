/* Booking overlay.
 *
 * Any element carrying data-book opens it — the button lives in several places on the
 * page and there is only ever one dialog, built the first time it is needed.
 *
 * The calendar is drawn from /api/booking/availability, which only ever says whether a
 * slot is open, never who holds it. Availability is re-checked on the server when the
 * form is submitted, because the customer may have had the dialog open for a while and
 * two people can be looking at the same free morning.
 *
 * Vanilla, no build step, no dependencies — same as the rest of the site.
 */
(function () {
  'use strict';

  var API = '/api/booking';
  var DAY_LETTERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var PHONE = '705 888 2651';

  var dlg = null;
  var els = {};
  var state = { data: null, date: null, block: null, month: null, sending: false, loaded: false };

  // ------------------------------------------------------------------ utils ---
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function parts(iso) {
    var bits = String(iso).split('-');
    return { y: Number(bits[0]), m: Number(bits[1]), d: Number(bits[2]) };
  }

  function monthKey(iso) {
    var p = parts(iso);
    return p.y * 12 + (p.m - 1);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isoOf(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  /* Monday-first column for a date, without touching local time zones. */
  function columnOf(iso) {
    var p = parts(iso);
    return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
  }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function prettyDate(iso) {
    var p = parts(iso);
    var d = new Date(Date.UTC(p.y, p.m - 1, p.d));
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
      }).format(d);
    } catch (err) {
      return iso;
    }
  }

  /* Roy sets slot times as 24-hour in the admin because that is what a time input
     gives him. Customers read a clock, so show 8am – 12pm, not 08:00 – 12:00. */
  function clock(hhmm) {
    var bits = String(hhmm).split(':');
    var h = Number(bits[0]);
    var m = Number(bits[1]);
    var suffix = h < 12 ? 'am' : 'pm';
    var hour = h % 12;
    if (hour === 0) hour = 12;
    return hour + (m ? '.' + (m < 10 ? '0' + m : m) : '') + suffix;
  }

  function slotTime(b) { return clock(b.start) + ' – ' + clock(b.end); }

  function blockById(id) {
    var list = (state.data && state.data.blocks) || [];
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
    return null;
  }

  function dayByDate(iso) {
    var list = (state.data && state.data.days) || [];
    for (var i = 0; i < list.length; i += 1) if (list[i].date === iso) return list[i];
    return null;
  }

  function say(text, kind) {
    els.note.textContent = text || '';
    els.note.className = 'bk-note' + (text ? ' is-' + (kind || 'bad') : ' bk-hide');
  }

  // ------------------------------------------------------------------ build ---
  function build() {
    dlg = el('dialog', 'bk-dlg');
    dlg.setAttribute('aria-label', 'Request a booking');

    var head = el('div', 'bk-head');
    els.title = el('h2', 'bk-title', 'Request a booking');
    var close = el('button', 'bk-x');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&times;';
    close.addEventListener('click', function () { dlg.close(); });
    head.appendChild(els.title);
    head.appendChild(close);

    els.body = el('div', 'bk-body');
    dlg.appendChild(head);
    dlg.appendChild(els.body);

    // Native dialog gives us Esc, focus trapping and the backdrop for free.
    dlg.addEventListener('click', function (ev) {
      if (ev.target === dlg) dlg.close();   // click outside the panel
    });
    document.body.appendChild(dlg);
  }

  function buildForm() {
    els.body.innerHTML = '';

    els.blurb = el('p', 'bk-blurb', state.data.blurb || '');
    els.body.appendChild(els.blurb);

    // --- calendar
    var cal = el('div', 'bk-cal');
    var nav = el('div', 'bk-nav');
    els.prev = el('button', 'bk-arrow');
    els.prev.type = 'button';
    els.prev.setAttribute('aria-label', 'Previous month');
    els.prev.innerHTML = '&lsaquo;';
    els.month = el('span', 'bk-month');
    els.next = el('button', 'bk-arrow');
    els.next.type = 'button';
    els.next.setAttribute('aria-label', 'Next month');
    els.next.innerHTML = '&rsaquo;';
    els.prev.addEventListener('click', function () { stepMonth(-1); });
    els.next.addEventListener('click', function () { stepMonth(1); });
    nav.appendChild(els.prev);
    nav.appendChild(els.month);
    nav.appendChild(els.next);
    cal.appendChild(nav);

    var heads = el('div', 'bk-grid bk-grid-head');
    DAY_LETTERS.forEach(function (d) {
      var cell = el('span', 'bk-dow', d.slice(0, 1));
      cell.setAttribute('aria-label', d);
      heads.appendChild(cell);
    });
    cal.appendChild(heads);

    els.grid = el('div', 'bk-grid');
    cal.appendChild(els.grid);

    var key = el('p', 'bk-key', 'Greyed days are fully booked or a day off.');
    cal.appendChild(key);
    els.body.appendChild(cal);

    // --- slot choice
    els.slots = el('div', 'bk-slots bk-hide');
    els.body.appendChild(els.slots);

    // --- details
    els.form = el('form', 'bk-form bk-hide');
    els.form.noValidate = true;

    function field(name, label, type, required, autocomplete) {
      var wrap = el('label', 'bk-field');
      wrap.appendChild(el('span', 'bk-label', label));
      var input = type === 'textarea' ? el('textarea') : el('input');
      if (type !== 'textarea') input.type = type;
      input.name = name;
      input.required = !!required;
      if (autocomplete) input.autocomplete = autocomplete;
      if (type === 'textarea') input.rows = 3;
      wrap.appendChild(input);
      els[name] = input;
      return wrap;
    }

    var pair = el('div', 'bk-pair');
    pair.appendChild(field('name', 'Your name', 'text', true, 'name'));
    pair.appendChild(field('phone', 'Phone', 'tel', true, 'tel'));
    els.form.appendChild(pair);
    els.form.appendChild(field('email', 'Email (optional)', 'email', false, 'email'));
    els.form.appendChild(field('address', 'Address for the job', 'text', true, 'street-address'));
    els.form.appendChild(field('job', "What's the job?", 'textarea', true, null));

    // Honeypot — off-screen, not display:none, so bots fill it and people never see it.
    var trap = el('div', 'bk-trap');
    trap.setAttribute('aria-hidden', 'true');
    var trapInput = el('input');
    trapInput.type = 'text';
    trapInput.name = 'company';
    trapInput.tabIndex = -1;
    trapInput.autocomplete = 'off';
    trap.appendChild(trapInput);
    els.company = trapInput;
    els.form.appendChild(trap);

    els.note = el('p', 'bk-note bk-hide');
    els.form.appendChild(els.note);

    els.submit = el('button', 'btn btn-primary bk-send', 'Send request');
    els.submit.type = 'submit';
    els.form.appendChild(els.submit);

    els.form.addEventListener('submit', submit);
    els.body.appendChild(els.form);

    state.month = monthKey(state.data.firstDay);
    renderMonth();
  }

  // --------------------------------------------------------------- calendar ---
  function stepMonth(delta) {
    var first = monthKey(state.data.firstDay);
    var last = monthKey(state.data.lastDay);
    var next = state.month + delta;
    if (next < first || next > last) return;
    state.month = next;
    renderMonth();
  }

  function renderMonth() {
    var y = Math.floor(state.month / 12);
    var m = (state.month % 12) + 1;
    els.month.textContent = MONTHS[m - 1] + ' ' + y;
    els.prev.disabled = state.month <= monthKey(state.data.firstDay);
    els.next.disabled = state.month >= monthKey(state.data.lastDay);

    els.grid.innerHTML = '';
    var lead = columnOf(isoOf(y, m, 1));
    for (var i = 0; i < lead; i += 1) els.grid.appendChild(el('span', 'bk-pad'));

    var total = daysInMonth(y, m);
    for (var d = 1; d <= total; d += 1) {
      var iso = isoOf(y, m, d);
      var day = dayByDate(iso);
      var btn = el('button', 'bk-day', String(d));
      btn.type = 'button';
      if (!day) {
        btn.className = 'bk-day is-out';
        btn.disabled = true;
        btn.setAttribute('aria-label', prettyDate(iso) + ' — not bookable');
      } else if (!day.any) {
        btn.className = 'bk-day is-off';
        btn.disabled = true;
        btn.setAttribute('aria-label', prettyDate(iso) + ' — fully booked or closed');
      } else {
        btn.setAttribute('aria-label', prettyDate(iso) + ' — slots available');
        if (iso === state.date) btn.className = 'bk-day is-on';
        btn.addEventListener('click', pickDay(iso));
      }
      els.grid.appendChild(btn);
    }
  }

  function pickDay(iso) {
    return function () {
      state.date = iso;
      state.block = null;
      renderMonth();
      renderSlots();
    };
  }

  function renderSlots() {
    var day = dayByDate(state.date);
    els.slots.innerHTML = '';
    els.slots.classList.remove('bk-hide');

    els.slots.appendChild(el('h3', 'bk-sub', prettyDate(state.date)));
    var list = el('div', 'bk-opts');

    (state.data.blocks || []).forEach(function (b) {
      var slot = null;
      for (var i = 0; i < day.slots.length; i += 1) {
        if (day.slots[i].block === b.id) slot = day.slots[i];
      }
      var open = slot && slot.open;
      var btn = el('button', 'bk-opt' + (open ? '' : ' is-full'));
      btn.type = 'button';
      btn.disabled = !open;
      btn.appendChild(el('b', null, b.label));
      btn.appendChild(el('span', null, slotTime(b)));
      if (!open) btn.appendChild(el('em', null, 'Taken'));
      if (state.block === b.id) btn.className += ' is-on';
      btn.addEventListener('click', function () {
        state.block = b.id;
        renderSlots();
        els.form.classList.remove('bk-hide');
        els.name.focus();
      });
      list.appendChild(btn);
    });

    els.slots.appendChild(list);
  }

  // ----------------------------------------------------------------- submit ---
  function submit(ev) {
    ev.preventDefault();
    if (state.sending) return;

    if (!state.date || !state.block) return say('Please choose a day and a time.');
    var payload = {
      name: els.name.value, phone: els.phone.value, email: els.email.value,
      address: els.address.value, job: els.job.value, company: els.company.value,
      date: state.date, block: state.block,
    };
    if (!payload.name.trim()) { els.name.focus(); return say('Please give me your name.'); }
    if (!payload.phone.trim()) { els.phone.focus(); return say('Please give a phone number.'); }
    if (!payload.address.trim()) { els.address.focus(); return say('Please give the address.'); }
    if (!payload.job.trim()) { els.job.focus(); return say('Please tell me about the job.'); }

    state.sending = true;
    els.submit.disabled = true;
    els.submit.textContent = 'Sending…';
    say('');

    fetch(API + '/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().catch(function () { return {}; })
        .then(function (body) { return { status: r.status, body: body }; });
    }).then(function (r) {
      state.sending = false;
      els.submit.disabled = false;
      els.submit.textContent = 'Send request';
      if (r.status === 409 || (r.body && r.body.stale)) {
        // Someone got there first. Reload the calendar so they can see what's left.
        say(r.body.error || 'That slot has just gone. Please pick another.', 'bad');
        return load(true);
      }
      if (r.body && r.body.error) return say(r.body.error);
      if (!r.body || !r.body.ok) return say('Something went wrong. Please call ' + PHONE + '.');
      done(r.body);
    }).catch(function () {
      state.sending = false;
      els.submit.disabled = false;
      els.submit.textContent = 'Send request';
      say('Could not reach the site. Please call ' + PHONE + '.');
    });
  }

  function done(result) {
    var block = blockById(result.block);
    els.title.textContent = 'Request sent';
    els.body.innerHTML = '';
    var box = el('div', 'bk-done');
    box.appendChild(el('h3', 'bk-sub', 'Thanks — I have your request.'));
    box.appendChild(el('p', null, prettyDate(result.date)
      + (block ? ' · ' + block.label + ', ' + slotTime(block) : '')));
    box.appendChild(el('p', null, "I'll call you to confirm, usually the same day. "
      + 'That slot is held for you until then.'));
    box.appendChild(el('p', 'bk-ref', 'Reference ' + result.reference));
    var call = el('a', 'btn btn-primary', 'Call ' + PHONE);
    call.href = 'tel:+17058882651';
    box.appendChild(call);
    els.body.appendChild(box);
  }

  // ------------------------------------------------------------------- load ---
  function loading(text) {
    els.body.innerHTML = '';
    els.body.appendChild(el('p', 'bk-blurb', text));
  }

  function closed(message) {
    els.body.innerHTML = '';
    var box = el('div', 'bk-done');
    box.appendChild(el('p', null, message));
    var call = el('a', 'btn btn-primary', 'Call ' + PHONE);
    call.href = 'tel:+17058882651';
    box.appendChild(call);
    els.body.appendChild(box);
  }

  function load(keepOpenSlot) {
    return fetch(API + '/availability', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.data = data;
        state.loaded = true;
        if (!data.enabled) {
          return closed('Online booking is closed at the moment — give me a ring and '
            + "we'll sort something out.");
        }
        els.title.textContent = data.title || 'Request a booking';
        var hadDate = keepOpenSlot ? state.date : null;
        state.date = null;
        state.block = null;
        buildForm();
        // After a clash, put them back on the day they were looking at.
        if (hadDate && dayByDate(hadDate) && dayByDate(hadDate).any) {
          state.month = monthKey(hadDate);
          state.date = hadDate;
          renderMonth();
          renderSlots();
        }
      })
      .catch(function () {
        closed('I could not load the calendar just now. Please call and I will book you in.');
      });
  }

  function open() {
    if (!dlg) build();
    if (typeof dlg.showModal !== 'function') {
      // Very old browser: send them to the phone rather than a broken dialog.
      window.location.href = 'tel:+17058882651';
      return;
    }
    dlg.showModal();
    if (!state.loaded) {
      loading('Loading the calendar…');
      load();
    }
  }

  document.addEventListener('click', function (ev) {
    var trigger = ev.target.closest ? ev.target.closest('[data-book]') : null;
    if (!trigger) return;
    ev.preventDefault();
    open();
  });
}());
