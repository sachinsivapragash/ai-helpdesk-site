// Seed data for the FAQ, error-code and event tables. FAQs and error codes are upserted on
// every start so edits here reach the database; events are only inserted once so booked
// seat counts are kept across restarts.
const config = require('../config');

const { name: site, campus } = config.site;
const { name: owner, email } = config.owner;

const faqs = [
  {
    category: 'About',
    question: `What is ${site}?`,
    answer: `${site} is a campus event booking website for students at ${campus}. You can browse upcoming workshops, hackathons, cultural nights and sports events, book seats online, and get help from the AI assistant. It was built by ${owner}.`,
    keywords: 'what eventease about website purpose who built campus',
  },
  {
    category: 'Booking',
    question: 'How do I book a seat for an event?',
    answer: 'Open the Events page, pick an event and click "Book seats". Enter your name, college email and the number of seats (1 to 4), then confirm. You get a booking reference starting with BK- straight away.',
    keywords: 'book booking reserve register seat seats ticket tickets how join',
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
    answer: 'Open a support ticket with your booking reference (BK-...) and we will cancel it and release the seats. Free events need no refund. For paid events you have not paid yet, so nothing is charged.',
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
    answer: 'Workshops and hackathons give e-certificates to everyone who checks in. They are emailed to the address you booked with within 7 days of the event.',
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
    answer: 'Each event card on the Events page shows the weather forecast for that day (from the Open-Meteo weather service) once the date is within two weeks. If heavy rain is expected, outdoor events move to the indoor backup venue and booked students are emailed.',
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

// days: how many days after the first start the event takes place.
const events = [
  { slug: 'hack-the-campus', title: 'Hack the Campus 24h Hackathon', category: 'Hackathon', days: 9, hour: 9, venue: 'Main Auditorium', price: 0, capacity: 120,
    description: 'Build a working app in 24 hours with a team of up to four. Mentors, food and prizes for the top three teams.' },
  { slug: 'ai-for-beginners', title: 'AI for Beginners Workshop', category: 'Workshop', days: 4, hour: 14, venue: 'Lab 3, CS Block', price: 0, capacity: 40,
    description: 'A hands-on introduction to using AI APIs from JavaScript. Bring a laptop; no prior AI experience needed.' },
  { slug: 'cultural-night', title: 'Rhythm Cultural Night', category: 'Cultural', days: 15, hour: 18, venue: 'Open Air Theatre', price: 100, capacity: 400,
    description: 'Music, dance and drama performances by student clubs, followed by a DJ night. Outdoor event.' },
  { slug: 'startup-talk', title: 'From Idea to Startup: Founder Talk', category: 'Talk', days: 6, hour: 16, venue: 'Seminar Hall 1', price: 0, capacity: 150,
    description: 'Alumni founders share how they turned college projects into companies, with a Q&A session.' },
  { slug: 'inter-dept-cricket', title: 'Inter-Department Cricket Final', category: 'Sports', days: 11, hour: 15, venue: 'College Ground', price: 0, capacity: 300,
    description: 'Watch the final of the inter-department T10 cricket league. Outdoor event; seating in the stands.' },
  { slug: 'resume-clinic', title: 'Resume & LinkedIn Clinic', category: 'Workshop', days: 2, hour: 11, venue: 'Placement Cell', price: 0, capacity: 2,
    description: 'One-to-one review of your resume and LinkedIn profile by the placement team. Very limited seats.' },
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

  for (const ev of events) {
    await query(
      `INSERT INTO events (slug, title, category, description, venue, starts_at, price, capacity)
       VALUES ($1, $2, $3, $4, $5,
               (date_trunc('day', NOW() AT TIME ZONE $10) + make_interval(days => $6, hours => $7)) AT TIME ZONE $10,
               $8, $9)
       ON CONFLICT (slug) DO UPDATE
         SET title = EXCLUDED.title, category = EXCLUDED.category, description = EXCLUDED.description,
             venue = EXCLUDED.venue, price = EXCLUDED.price, capacity = EXCLUDED.capacity`,
      [ev.slug, ev.title, ev.category, ev.description, ev.venue, ev.days, ev.hour, ev.price, ev.capacity, config.site.timezone]
    );
  }

  // Keep the demo evergreen: events more than a day in the past move forward in 3-week steps
  // and start again with no bookings.
  const stale = await query(
    "SELECT id FROM events WHERE starts_at < NOW() - INTERVAL '1 day'"
  );
  if (stale.length) {
    const ids = stale.map((r) => r.id);
    await query('DELETE FROM bookings WHERE event_id = ANY($1)', [ids]);
    await query(
      `UPDATE events
          SET starts_at = starts_at + make_interval(days => 21 * CEIL(EXTRACT(EPOCH FROM NOW() - starts_at) / (21 * 86400))::int),
              booked = 0
        WHERE id = ANY($1)`,
      [ids]
    );
  }
}

module.exports = { seed };
