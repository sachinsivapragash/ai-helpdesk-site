// The demo events. Each slot shows one event at a time; when it ends, the slot moves forward
// three weeks and shows the next event in its list, so repeats are different events.
// days: days after the first start for the first event in each slot. hour: local start time.
const slots = [
  {
    slot: 'hack-the-campus', category: 'Hackathon', days: 9,
    variants: [
      { slug: 'hack-the-campus', title: 'Hack the Campus 24h Hackathon', hour: 9, venue: 'Main Auditorium', price: 0, capacity: 120,
        description: 'Build a working app in 24 hours with a team of up to four. Mentors, food and prizes for the top three teams.' },
      { slug: 'codesprint-web-challenge', title: 'CodeSprint: 12-Hour Web App Challenge', hour: 8, venue: 'Innovation Centre', price: 0, capacity: 100,
        description: 'Teams of up to three build and deploy a web app in 12 hours. Judged on usefulness, design and a live demo.' },
      { slug: 'build-for-bharat', title: 'Build for Bharat Social-Impact Hackathon', hour: 9, venue: 'Main Auditorium', price: 0, capacity: 120,
        description: 'Solve real problems from local NGOs in healthcare, farming and education. Winning ideas get incubation support.' },
    ],
  },
  {
    slot: 'ai-for-beginners', category: 'Workshop', days: 4,
    variants: [
      { slug: 'ai-for-beginners', title: 'AI for Beginners Workshop', hour: 14, venue: 'Lab 3, CS Block', price: 0, capacity: 40,
        description: 'A hands-on introduction to using AI APIs from JavaScript. Bring a laptop; no prior AI experience needed.' },
      { slug: 'git-github-bootcamp', title: 'Git & GitHub Bootcamp', hour: 14, venue: 'Lab 2, CS Block', price: 0, capacity: 40,
        description: 'Learn commits, branches, pull requests and fixing merge conflicts on real projects. Bring a laptop with Git installed.' },
      { slug: 'first-mobile-app', title: 'Build Your First Mobile App', hour: 10, venue: 'Lab 3, CS Block', price: 0, capacity: 35,
        description: 'Create and run a simple Android app in one afternoon, step by step. Bring a laptop; an Android phone helps.' },
    ],
  },
  {
    slot: 'cultural-night', category: 'Cultural', days: 15,
    variants: [
      { slug: 'cultural-night', title: 'Rhythm Cultural Night', hour: 18, venue: 'Open Air Theatre', price: 100, capacity: 400,
        description: 'Music, dance and drama performances by student clubs, followed by a DJ night. Outdoor event.' },
      { slug: 'battle-of-the-bands', title: 'Battle of the Bands', hour: 18, venue: 'Open Air Theatre', price: 150, capacity: 400,
        description: 'College bands compete live for the trophy, with the audience vote counting towards the result. Outdoor event.' },
      { slug: 'kalai-vizha', title: 'Kalai Vizha Folk Arts Evening', hour: 17, venue: 'Main Auditorium', price: 50, capacity: 350,
        description: 'Parai, karakattam, silambam and folk music performances celebrating Tamil arts, with food stalls outside.' },
    ],
  },
  {
    slot: 'startup-talk', category: 'Talk', days: 6,
    variants: [
      { slug: 'startup-talk', title: 'From Idea to Startup: Founder Talk', hour: 16, venue: 'Seminar Hall 1', price: 0, capacity: 150,
        description: 'Alumni founders share how they turned college projects into companies, with a Q&A session.' },
      { slug: 'product-interviews', title: 'Cracking Product Company Interviews', hour: 16, venue: 'Seminar Hall 2', price: 0, capacity: 150,
        description: 'Engineers from product companies explain their hiring rounds, with sample questions and a live mock round.' },
      { slug: 'women-in-tech', title: 'Women in Tech Panel', hour: 15, venue: 'Seminar Hall 1', price: 0, capacity: 150,
        description: 'Women engineers and founders talk about careers, internships and building confidence in tech. Open to everyone.' },
    ],
  },
  {
    slot: 'inter-dept-cricket', category: 'Sports', days: 11,
    variants: [
      { slug: 'inter-dept-cricket', title: 'Inter-Department Cricket Final', hour: 15, venue: 'College Ground', price: 0, capacity: 300,
        description: 'Watch the final of the inter-department T10 cricket league. Outdoor event; seating in the stands.' },
      { slug: 'inter-college-football', title: 'Inter-College Football Cup', hour: 16, venue: 'Football Ground', price: 0, capacity: 300,
        description: 'Teams from colleges across Coimbatore compete in a one-day knockout football cup. Outdoor event.' },
      { slug: 'campus-5k-run', title: 'Campus 5K Fun Run', hour: 6, venue: 'Main Gate', price: 0, capacity: 250,
        description: 'An early-morning 5 km run around the campus for all fitness levels. Finishers get a medal. Outdoor event.' },
    ],
  },
  {
    slot: 'resume-clinic', category: 'Workshop', days: 2,
    variants: [
      { slug: 'resume-clinic', title: 'Resume & LinkedIn Clinic', hour: 11, venue: 'Placement Cell', price: 0, capacity: 2,
        description: 'One-to-one review of your resume and LinkedIn profile by the placement team. Very limited seats.' },
      { slug: 'mock-interview', title: 'Mock Interview Session', hour: 11, venue: 'Placement Cell', price: 0, capacity: 2,
        description: 'A 30-minute one-to-one practice interview with feedback from the placement team. Very limited seats.' },
      { slug: 'portfolio-review', title: 'Portfolio Review with a Designer', hour: 12, venue: 'Design Studio', price: 0, capacity: 2,
        description: 'Get honest feedback on your project portfolio or GitHub profile from a working designer. Very limited seats.' },
    ],
  },
  {
    slot: 'tech-symposium', category: 'Symposium', days: 13,
    variants: [
      { slug: 'techfest-paper-presentation', title: 'TechFest Paper Presentation', hour: 10, venue: 'Seminar Hall 2', price: 100, capacity: 80,
        description: 'Present a technical paper on any computing topic to a panel of faculty judges. Certificates for all, prizes for the top three.' },
      { slug: 'project-expo', title: 'Final-Year Project Expo', hour: 10, venue: 'Main Corridor, Block A', price: 0, capacity: 200,
        description: 'Walk through stalls of final-year projects, try live demos and vote for the best project of the year.' },
      { slug: 'code-debug-contest', title: 'Debugging Contest: Find the Bug', hour: 14, venue: 'Lab 1, CS Block', price: 50, capacity: 60,
        description: 'Fix as many broken programs as you can in 90 minutes, solo or in pairs. C, Java and Python rounds.' },
    ],
  },
  {
    slot: 'club-meetup', category: 'Club', days: 7,
    variants: [
      { slug: 'photography-walk', title: 'Photography Club Campus Walk', hour: 16, venue: 'Meet at Library Steps', price: 0, capacity: 30,
        description: 'Learn composition and phone photography tips on a guided golden-hour walk around campus. Bring any camera or phone.' },
      { slug: 'open-mic-night', title: 'Literary Club Open Mic', hour: 17, venue: 'Amphitheatre', price: 0, capacity: 120,
        description: 'Poetry, stories and stand-up in English or Tamil. Sign up to perform on the spot, or just come and listen.' },
      { slug: 'robotics-club-demo', title: 'Robotics Club Demo Day', hour: 15, venue: 'Robotics Lab', price: 0, capacity: 50,
        description: 'See line followers, robotic arms and drones built by the club, and find out how to join this semester.' },
    ],
  },
];

function variantFor(slot, variant) {
  const s = slots.find((x) => x.slot === slot);
  if (!s) return null;
  return { ...s.variants[((variant % s.variants.length) + s.variants.length) % s.variants.length], category: s.category };
}

module.exports = { slots, variantFor };
