// Seed data for the FAQ, error-code and event tables. FAQs and error codes are upserted on
// every start so edits here reach the database; events are only inserted once so booked
// seat counts are kept across restarts.
const config = require('../config');
const { rollForwardPastEvents } = require('./evergreen');
const { slots: eventSlots, variantFor } = require('./eventCatalog');

const { name: site, campus } = config.site;
const { name: owner, email } = config.owner;

const faqs = [
  {
    category: 'About',
    question: `What is ${site}?`,
    answer: `${site} is a campus event booking website for students at ${campus}. You can browse upcoming workshops, hackathons, talks, symposiums, club activities, cultural nights and sports events, book seats online, and get help from the AI assistant. It was built by ${owner}.`,
    keywords: 'what eventease about website purpose who built campus',
  },
  {
    category: 'Booking',
    question: 'How do I book a seat for an event?',
    answer: 'Open the Events page, pick an event and click "Book seats". Enter your name, college email and the number of seats (1 to 4), then confirm. You get a booking reference starting with BK- straight away, and a confirmation email with the details is sent to the address you booked with.',
    keywords: 'book booking reserve register seat seats ticket tickets how join confirmation email',
  },
  {
    category: 'Booking',
    question: 'How many seats can I book at once?',
    answer: 'You can book up to 4 seats per event with one email address, so you can bring friends. Each email can make only one booking per event; to change the number of seats, cancel and book again.',
    keywords: 'how many seats limit maximum friends group multiple',
  },
  {
    category: 'Booking',
    question: 'What happens when an event is sold out?',
    answer: 'When all seats are taken the event shows "Sold out" and new bookings return error EVT-409. Seats sometimes free up when people cancel, so check back later or open a support ticket to join the waiting list.',
    keywords: 'sold out full no seats waitlist waiting list evt-409 capacity',
  },
  {
    category: 'Payments',
    question: 'Are events free? How do I pay for paid events?',
    answer: 'Most events are free. Paid events show the ticket price on the Events page, and you pay at the venue help desk on the day using UPI or cash. Your booking reference holds your seat until the event starts.',
    keywords: 'free price cost pay payment paid fee money upi cash rupees',
  },
  {
    category: 'Cancellations',
    question: 'How do I cancel a booking or get a refund?',
    answer: 'Open a support ticket with your booking reference (BK-...) and the organisers will cancel it and release the seats. You get a cancellation email when it is done. Free events need no refund. For paid events you have not paid yet, so nothing is charged.',
    keywords: 'cancel cancellation refund change booking undo money back',
  },
  {
    category: 'On the day',
    question: 'What do I need to bring on the day of the event?',
    answer: 'Bring your college ID card and your booking reference (a screenshot is fine). Please arrive 15 minutes early; seats of people who have not checked in 10 minutes after the start may be given to the waiting list.',
    keywords: 'bring id card entry check in arrive day venue what need',
  },
  {
    category: 'On the day',
    question: 'Will I get a participation certificate?',
    answer: 'Workshops and hackathons give participation certificates to everyone who checks in. Collect yours from the event help desk at the end of the event, using your booking reference.',
    keywords: 'certificate participation e-certificate proof attendance',
  },
  {
    category: 'Events',
    question: 'Can I suggest or host my own event?',
    answer: `Yes. Clubs and student groups can propose an event by opening a support ticket with the title, date, venue and expected audience. ${owner} reviews requests and adds approved events to the site.`,
    keywords: 'host organise organize suggest propose add my own event club',
  },
  {
    category: 'Events',
    question: 'How do I know if bad weather will affect an outdoor event?',
    answer: 'Each event card on the Events page shows the weather forecast for that day (from the Open-Meteo or MET Norway weather services) once the date is within two weeks. If heavy rain is expected, outdoor events move to the indoor backup venue, and the new venue is shown on the Events page, so check it on the day.',
    keywords: 'weather rain forecast outdoor postponed moved indoor',
  },
  {
    category: 'Assistant',
    question: 'How does the AI assistant work?',
    answer: `The assistant answers using only the FAQ, error-code and event data stored in ${site}'s database. It uses an AI model (Google Gemini or Claude) when available and falls back to keyword matching if the AI is slow or unavailable. If it cannot answer, it creates a support ticket instead of guessing.`,
    keywords: 'assistant ai chatbot bot how work claude answer',
  },
  {
    category: 'Support',
    question: 'How do I contact support or check my ticket?',
    answer: `Use the Support page to open a ticket or check one with its TCK- reference, or email ${email}. Tickets are usually answered within one working day.`,
    keywords: 'contact support help email ticket status check reach human',
  },
];

const errorCodes = [
  {
    code: '400', http_status: 400, title: 'Bad Request',
    meaning: 'Something in your request was missing or invalid, for example an empty chat message, an invalid email address, or a seat count outside 1 to 4.',
    user_action: 'Check what you entered, fill in all required fields and try again.',
  },
  {
    code: '401', http_status: 401, title: 'Unauthorized',
    meaning: 'This action needs you to sign in or provide an access token, and none was given. On EventEase it appears when the organiser dashboard is opened without the admin token.',
    user_action: 'Provide a valid access token. Students do not need this area.',
  },
  {
    code: '403', http_status: 403, title: 'Forbidden',
    meaning: 'You are identified but not allowed to do this. On EventEase it appears when a wrong admin token is used on the organiser dashboard.',
    user_action: 'Use the correct token, or contact the organiser if you think you should have access.',
  },
  {
    code: '404', http_status: 404, title: 'Not Found',
    meaning: 'The page, event or booking at this address does not exist. The link may be mistyped, or the event may have been removed.',
    user_action: 'Check the address, go back to the Events page, or use the menu.',
  },
  {
    code: '429', http_status: 429, title: 'Too Many Requests',
    meaning: 'Too many requests were sent in a short time, so the rate limit was reached. This protects the booking system and the AI assistant from overload.',
    user_action: 'Wait about a minute, then try again.',
  },
  {
    code: '500', http_status: 500, title: 'Internal Server Error',
    meaning: 'Something went wrong on the server while handling your request. It is a problem with the site, not with anything you did.',
    user_action: 'Refresh or try again later. If it keeps happening, open a support ticket.',
  },
  {
    code: '503', http_status: 503, title: 'Service Unavailable',
    meaning: 'The server or one of its services (such as the database) is temporarily unavailable, often because of maintenance or overload.',
    user_action: 'Try again in a few minutes. The Health page shows which service is down.',
  },
  {
    code: 'EVT-409', http_status: 409, title: 'Event Sold Out (site-specific)',
    meaning: `${site}'s own code: there are not enough seats left for this booking, or you have already booked this event with the same email.`,
    user_action: 'Try fewer seats, pick another event, or open a support ticket to join the waiting list.',
    site_specific: true,
  },
  {
    code: 'EVT-460', http_status: 413, title: 'Chat Message Too Long (site-specific)',
    meaning: `${site}'s own code: your message to the AI assistant was longer than the 500-character limit, so it was not sent.`,
    user_action: 'Shorten your question to under 500 characters, or use the Support form for long requests.',
    site_specific: true,
  },
];


async function seed(query) {
  for (const [i, f] of faqs.entries()) {
    await query(
      `INSERT INTO faqs (category, question, answer, keywords, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (question) DO UPDATE
         SET category = EXCLUDED.category, answer = EXCLUDED.answer,
             keywords = EXCLUDED.keywords, sort_order = EXCLUDED.sort_order`,
      [f.category, f.question, f.answer, f.keywords, i + 1]
    );
  }
  // Remove FAQs that are no longer in the seed list (e.g. after the site topic changed).
  await query('DELETE FROM faqs WHERE NOT (question = ANY($1))', [faqs.map((f) => f.question)]);

  for (const e of errorCodes) {
    await query(
      `INSERT INTO error_codes (code, http_status, title, meaning, user_action, site_specific)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO UPDATE
         SET http_status = EXCLUDED.http_status, title = EXCLUDED.title, meaning = EXCLUDED.meaning,
             user_action = EXCLUDED.user_action, site_specific = EXCLUDED.site_specific`,
      [e.code, e.http_status, e.title, e.meaning, e.user_action, Boolean(e.site_specific)]
    );
  }
  await query('DELETE FROM error_codes WHERE NOT (code = ANY($1))', [errorCodes.map((e) => e.code)]);

  // One row per event slot. New slots start with their first event; existing slots keep their
  // date, bookings and current event, and get any text changes from the catalogue.
  for (const slot of eventSlots) {
    const first = slot.variants[0];
    await query(
      `INSERT INTO events (slot, variant, slug, title, category, description, venue, starts_at, price, capacity)
       VALUES ($1, 0, $2, $3, $4, $5, $6,
               (date_trunc('day', NOW() AT TIME ZONE $7) + make_interval(days => $8, hours => $9)) AT TIME ZONE $7,
               $10, $11)
       ON CONFLICT (slot) DO NOTHING`,
      [slot.slot, first.slug, first.title, slot.category, first.description, first.venue, config.site.timezone,
        slot.days, first.hour, first.price, first.capacity]
    );
    const [row] = await query('SELECT variant FROM events WHERE slot = $1', [slot.slot]);
    const v = variantFor(slot.slot, row.variant);
    await query(
      `UPDATE events SET slug = $2, title = $3, category = $4, description = $5, venue = $6, price = $7, capacity = $8
        WHERE slot = $1`,
      [slot.slot, v.slug, v.title, v.category, v.description, v.venue, v.price, v.capacity]
    );
  }

  // Keep the demo evergreen (see rollForwardPastEvents in services/events.js).
  await rollForwardPastEvents(query);
}

module.exports = { seed };
