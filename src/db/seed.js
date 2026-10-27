// Seed data for the FAQ and error-code tables. Upserted on every start so edits here
// (and changes to SITE_OWNER_* env vars) reach the database without a manual migration.
const config = require('../config');

const { name, email, github } = config.owner;

const faqs = [
  {
    category: 'About me',
    question: 'Who are you and what is this website?',
    answer: `This is the personal website of ${name}, a software development student. It showcases my projects and skills, and includes an AI assistant that answers common questions and explains error codes.`,
    keywords: 'who about you owner website purpose portfolio student',
  },
  {
    category: 'About me',
    question: 'What technologies and skills do you work with?',
    answer: 'My main stack is JavaScript and Node.js with Express on the backend, HTML, CSS and vanilla JavaScript on the frontend, PostgreSQL and MongoDB for data, and Git/GitHub for version control. I am also learning cloud deployment and AI API integration.',
    keywords: 'skills technologies stack languages tools javascript node express sql mongodb react',
  },
  {
    category: 'About me',
    question: 'Are you available for internships or freelance work?',
    answer: `Yes. I am open to internships, part-time roles and small freelance projects. Please email ${email} or use the Support page to send a message, and I will reply within two working days.`,
    keywords: 'internship job hire freelance work available opportunity recruit',
  },
  {
    category: 'Contact',
    question: 'How can I contact you?',
    answer: `Email ${email}, open a ticket from the Support page, or message me on GitHub (github.com/${github}). Tickets get a reference number so you can check their status later.`,
    keywords: 'contact email reach message talk get in touch',
  },
  {
    category: 'Projects',
    question: 'Where can I see your projects and source code?',
    answer: `The Projects page lists my latest public repositories, loaded live from the GitHub API. All source code is on github.com/${github}, including the code for this website.`,
    keywords: 'projects source code github repositories repo portfolio work',
  },
  {
    category: 'Assistant',
    question: 'How does the AI assistant work?',
    answer: 'The assistant answers using only the FAQ and error-code data stored in this site\'s SQL database. It uses the Claude API when available and falls back to keyword matching if the AI service is slow or unavailable. If it cannot answer confidently it creates a support ticket instead of guessing.',
    keywords: 'assistant ai chatbot bot how work claude answer',
  },
  {
    category: 'Assistant',
    question: 'What happens when the assistant cannot answer my question?',
    answer: 'It creates a support ticket automatically and gives you a reference number (for example TCK-1A2B3C). I review open tickets and reply by email if you left one. You can check a ticket\'s status on the Support page.',
    keywords: 'cannot answer unsure ticket escalate human help unknown',
  },
  {
    category: 'Support',
    question: 'How do I check the status of my support ticket?',
    answer: 'Go to the Support page, enter your ticket reference (it starts with TCK-) in the "Check a ticket" box, and you will see whether it is open, in progress, resolved or closed.',
    keywords: 'ticket status check reference track support progress',
  },
  {
    category: 'Privacy',
    question: 'What data do you store about me?',
    answer: 'Support tickets (your name, email and message, if you provide them) are stored in a PostgreSQL database. Chat messages and thumbs up/down feedback are stored in MongoDB to improve the assistant. No data is sold or shared, and you can ask for it to be deleted by opening a ticket.',
    keywords: 'privacy data store personal information gdpr delete cookies tracking',
  },
  {
    category: 'Website',
    question: 'Does the website work on mobile phones?',
    answer: 'Yes. The layout is responsive and has been tested on small phone screens, tablets and desktops. The chat widget opens as a full-width panel on phones.',
    keywords: 'mobile phone responsive tablet screen small device',
  },
  {
    category: 'Website',
    question: 'How is this website built and hosted?',
    answer: 'It is a Node.js/Express app served over HTTPS. FAQs, error codes and tickets live in PostgreSQL, chat logs and feedback in MongoDB, and API keys are kept in environment variables, never in the GitHub repository. A /health page reports the status of every dependency.',
    keywords: 'built hosted deploy deployment stack architecture server https render cloud',
  },
  {
    category: 'Website',
    question: 'Why do the projects show "offline list" instead of live GitHub data?',
    answer: 'The Projects page calls the GitHub API with a 3-second time limit. If GitHub is slow, rate-limited or down, the site shows a saved fallback list so the page still works. Refresh in a few minutes to get live data again.',
    keywords: 'projects offline fallback github slow not loading cached saved list',
  },
];

const errorCodes = [
  {
    code: '400', http_status: 400, title: 'Bad Request',
    meaning: 'The server could not understand the request because something in it was missing or invalid, for example an empty chat message or a form field in the wrong format.',
    user_action: 'Check the information you entered, fill in all required fields and try again.',
  },
  {
    code: '401', http_status: 401, title: 'Unauthorized',
    meaning: 'The page or action needs you to identify yourself, and no valid login or access token was provided. On this site it appears when the admin dashboard is opened without an admin token.',
    user_action: 'Sign in or provide a valid access token. If you are a visitor, you do not need this area.',
  },
  {
    code: '403', http_status: 403, title: 'Forbidden',
    meaning: 'The server knows who you are but you are not allowed to do this. On this site it appears when an incorrect admin token is used.',
    user_action: 'Use an account or token with the right permissions, or contact the site owner if you think you should have access.',
  },
  {
    code: '404', http_status: 404, title: 'Not Found',
    meaning: 'The page or resource at this address does not exist. The link may be mistyped, outdated, or the item may have been removed.',
    user_action: 'Check the address for typos, go back to the home page, or use the navigation menu.',
  },
  {
    code: '429', http_status: 429, title: 'Too Many Requests',
    meaning: 'You have sent too many requests in a short time and the rate limit was reached. This protects the site and the AI service from overload.',
    user_action: 'Wait about a minute and then try again.',
  },
  {
    code: '500', http_status: 500, title: 'Internal Server Error',
    meaning: 'Something went wrong on the server while handling your request. It is a problem with the site, not with anything you did.',
    user_action: 'Refresh the page or try again later. If it keeps happening, open a support ticket.',
  },
  {
    code: '503', http_status: 503, title: 'Service Unavailable',
    meaning: 'The server or one of its dependencies (such as the database) is temporarily unavailable, often because of maintenance or overload.',
    user_action: 'Try again in a few minutes. You can check the Health page to see which service is down.',
  },
  {
    code: 'SITE-460', http_status: 413, title: 'Chat Message Too Long (site-specific)',
    meaning: 'This website\'s own code: your message to the AI assistant was longer than the 500-character limit, so it was not sent.',
    user_action: 'Shorten your question to under 500 characters, or split it into several smaller questions. For long requests use the Support form instead.',
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
}

module.exports = { seed };
