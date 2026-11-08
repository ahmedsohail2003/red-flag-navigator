# Hack the North 2026 results, and the AirPods "Wii remote" project (Aircade)

Research date: 2026-11-07. All Devpost, GitHub and YouTube data below was downloaded fresh on 2026-11-07 (curl, gh CLI), parsed with scripts, and cross-checked: every one of the 72 winning project pages was fetched and its on-page "Winner" labels matched the gallery's embedded winners list (72 projects, 79 award entries). "Official" below means organizer-entered Devpost data (winner labels, prize list, rules) or the organizers' museum site; "second-hand" means team or social-media claims.

## What were the exact dates and format of Hack the North 2026, and where are the official results published?

### Takeaway
Hack the North 2026 ran Friday Sep 18 to Sunday Sep 20, 2026. It was an in-person, invite-only, students-only hackathon at the University of Waterloo (E5/PSE), with teams of up to 4 and a 36-hour build advertised. The official results are the winner labels on the Hack the North 2026 Devpost site: 72 winning projects out of 349 submissions. The 12 finalists, the top overall award, are also shown in the 2026 collection of museum.hackthenorth.com. I found no 2026 winners post on the HTN blog or in the news, no readable social post, and no closing-ceremony recording.

### Cited Findings
- Devpost overview page (official, organizer-run): "Sep 18 – 20, 2026", "University of Waterloo — E5/PSE", "Invite only", "39 non-cash prizes", "1030 participants" (Devpost registrations, as shown on 2026-11-07), "This hackathon has ended", "View the winners". Who can take part: "Accepted Hack the North participants", "Ages 13+ only", "Students only". The overview says: "Join 1000+ students from all around the globe at the University of Waterloo to build something incredible in just 36 hours". It also says registering on Devpost does not give access to the event. — [Hack the North 2026 Devpost](https://hackthenorth2026.devpost.com/) (fetched 2026-11-07)
- What to submit: the project, a link to the source code and design assets, the badge ID of every team member, and every sponsor prize the team wants, selected before 2:00 PM EDT Saturday. A demo video was optional. Judging criteria: "originality, user experience, technical complexity, and that all-important WOW factor", and the pitch had to be a live demo, not slides. — [Devpost overview](https://hackthenorth2026.devpost.com/)
- Rules: teams of up to 4, all present in person. All code and design assets had to be created between 12:00 AM EDT Saturday Sep 19, 2026 and 8:00 AM EDT Sunday Sep 20, 2026. A first version was due at 2:00 PM EDT Saturday Sep 19 (with team members, badge IDs and sponsor-prize choices), and teams could edit until 8:00 AM EDT Sunday. — [Devpost rules](https://hackthenorth2026.devpost.com/rules)
- Judging format, from the rules:
  - First round: a five-minute live demo in a judging room.
  - "The top two projects from each judging room advance to the second round." The second round ran at tables from 12:00 PM, with rotating pairs of judges (4 minutes of demo, then 1 minute of questions).
  - Sponsor judging ran 9:45 to 11:45 AM Sunday. Each sponsor judged every submission in person, reviewed on Devpost and then judged ten finalists in person, or judged entirely on Devpost. — [Devpost rules](https://hackthenorth2026.devpost.com/rules)
- Main award: "At Hack the North, there's no first, second, or third place in our main award — top projects become finalists." The "Hack the North 2026: Finalists" prize lists "12 winners" and says "The prizes for becoming a finalist are a surprise!" — [Devpost prizes section](https://hackthenorth2026.devpost.com/)
- Project gallery: 349 projects across 15 pages, and 72 of them carry a "Winner" badge. The page embeds a schema.org list named "Hack the North 2026 winners" with 72 projects and 79 award entries over 39 prize categories: 12 finalist slots plus 67 sponsor-prize slots across 38 sponsor categories. — [Devpost project gallery](https://hackthenorth2026.devpost.com/project-gallery) (fetched 2026-11-07)
- Museum of Hack the North (organizer site): its 2026 collection shows the same 12 finalists as Devpost (thumbnails for _solanasim, a-feuvb1, bing-bong-z7rsny, cadex, combadge, composition, concerto-0wd9zs, keymaeleon, punchface, reflex-e0jkih, takeone-erqv3l, temp-jcyltx). — [museum.hackthenorth.com](https://museum.hackthenorth.com/) (fetched 2026-11-07)
- University of Waterloo, Waterloo.AI Institute news, Wednesday September 23, 2026, by Charlotte Danby, Faculty of Engineering:
  - "University of Waterloo students put the city on the map last week with two stand-out events, Waterloo Tech Week and Hack the North."
  - "Now in its 13th year, Hack the North … welcomed more than 1,000 hackers who spent 36 straight hours building."
  - The article names no winners. — [UW Waterloo.AI news](https://uwaterloo.ca/artificial-intelligence-institute/news/students-are-building-waterloo-ambition-and-energy)
- hackthenorth.com returns only a JavaScript app shell ("You need to enable JavaScript to run this app") to non-browser fetches, so I could not check whether it lists winners. — [hackthenorth.com](https://hackthenorth.com/) (fetched 2026-11-07)

### Inferences
- The Devpost winner labels are the authoritative, organizer-entered results record. The museum repeats the finalists only. No other official channel I could read lists the sponsor-prize winners.
- The rules' code window (12:00 AM Saturday to 8:00 AM Sunday) is 32 hours, while the overview and UW both say 36 hours. Nothing I found reconciles the two; "36 hours" seems to be the event's standard description.
- If HTN used about 15 first-round judging rooms, "top two per room" would make about 30 second-round projects. That fits the "Top 30 Semifinalist" wording in social posts (see the Aircade section), but HTN does not publish the number of rooms.

### Gaps
- I found no closing-ceremony recording, no HTN Medium/blog 2026 recap, and no 2026 winners article from BetaKit, Imprint or UW News. Searches for a 2026 winners recap or the closing ceremony returned only older editions.
- Official Instagram, LinkedIn and X posts could not be read: LinkedIn returns HTTP 999 to fetches, and the others were not indexed in search.
- What finalists actually received is not published ("a surprise").
- The Devpost participant count is 1030 on the live page. A search snippet seen by an earlier researcher showed 1045 (unverified, probably a different snapshot).

## Which projects won the top overall prizes, and which were finalists? What did each build?

### Takeaway
There is no 1st, 2nd or 3rd overall place. The top award, "Hack the North 2026: Finalists", went to 12 projects, listed below. Five finalists also won sponsor prizes:
- Settlers of Solana: Solana
- Combadge: QNX
- punching-face: Sentry
- Composition: MLH Gemini
- Orbis Engine: OpenAI API Prizes

Besides the finalist award, 38 sponsor categories gave 67 awards to 65 projects. Whim and Pixie each won two sponsor prizes. Devpost does not show the placing (1st, 2nd or 3rd) within sponsor categories that have more than one winner.

### Cited Findings
Finalists ("Hack the North 2026: Finalists", 12 projects, in gallery order). Source for every row: that project's Devpost page plus the winners list on the [Devpost project gallery](https://hackthenorth2026.devpost.com/project-gallery), fetched 2026-11-07. Team names are exactly as shown on Devpost (some are handles).

| Project | Team (as listed on Devpost) | One-line description (Devpost tagline) | Devpost | Code / site | Demo video | Other prizes won |
|---|---|---|---|---|---|---|
| Settlers of Solana | Kyle Wang, Nigel Loh, Yiming Su | Swarm of AI agents simulates a free-market economy on Solana. | [Devpost](https://devpost.com/software/_solanasim) | [GitHub](https://github.com/leakyhose/agent-economy) | [YouTube](https://youtu.be/2_bnZhsAtcY) | Solana: Best Use of Solana and Badge Hack |
| TakeOne | Caesar Zhou, Ryan Qin, Basil Liu | TakeOne is an AI-powered robotic film studio. Describe your vision, and it plans and simulates each shot, moves the camera and lighting to film it, then helps edit the final video. | [Devpost](https://devpost.com/software/takeone-erqv3l) | [GitHub](https://github.com/3-rt/TakeOne) | [YouTube](https://youtu.be/v-cOBYdeZMY) | - |
| Keymaeleon | Ryan Tymkow, Michael Oh | Keymaeleon is a context-aware mechanical keyboard for developers, with OLED keys that adapt to what you’re doing and use AI to surface the most useful actions in the moment. | [Devpost](https://devpost.com/software/keymaeleon) | [GitHub](https://github.com/macto2024/Keymealeon.git) | none listed | - |
| Combadge | Dan (Dang Khoa) Chiem, Edmon Shi, Samuel Martineau, Alex Huang | Inspired by Star Trek’s combadge and ship’s computer: a wearable AI communicator combining voice, vision, and actions. Just say, “Computer.” | [Devpost](https://devpost.com/software/combadge) | [GitHub](https://github.com/orgs/Combadge-HTN/repositories) | [YouTube](https://youtu.be/ZbD7XTCFx-I) | QNX: Create an Embedded System with QNX that Uses AI |
| punching-face | Akash Nagabhirava, Mark Peng, Seeron Sivashankar, Jace Mu | punch ur face | [Devpost](https://devpost.com/software/punchface) | [GitHub](https://github.com/akashngb/punching-face) | [YouTube](https://youtu.be/wWvFjsOJgjA) | Sentry: Best Use of Sentry |
| Reflex | Kevin Zhao, Ryan Wang, Zechariah Wang, Eric Liu | We write skills for AI; what if AI could write skills for us? | [Devpost](https://devpost.com/software/reflex-e0jkih) | [GitHub](https://github.com/ZechariahWang/htn-2026/) | [YouTube](https://youtu.be/JRdbeijMIhU) | - |
| Composition | Justin Lam | A physical creative harness for agentic video creation | [Devpost](https://devpost.com/software/composition) | [GitHub](https://github.com/justinlam747/Composition) | [YouTube](https://youtu.be/IDO7cJnBtp0) | MLH: Best Use of Gemini API |
| Bricked | GuyOnWifi Huang, Moiz Hashmi, Xinda Yang | Turn any idea into a Lego design. | [Devpost](https://devpost.com/software/a-feuvb1) | [GitHub](https://github.com/GuyOnWifi/hack-the-north) | [YouTube](https://youtu.be/Ne6FrkvtLdk) | - |
| CADEX | Evan Johnstone, Justin Badua, Matthew Lones, Aaryan Biradar | Build for the real world without CAD experience. | [Devpost](https://devpost.com/software/cadex) | [GitHub](https://github.com/justinbaduaa/htn2026) | [YouTube](https://youtu.be/ib4n04WRrVw) | - |
| Orbis Engine | Daniel Pu, Aayan Karmali, James Li, Austin Jian | Anything ever filmed, in 4D. | [Devpost](https://devpost.com/software/temp-jcyltx) | [GitHub](https://github.com/dtpu/OrbisEngine) | [YouTube](https://youtu.be/fvC2Ax81VGE) | OpenAI: API Prizes |
| bingbong | Sophia Duan, acon lin, Bob The builder, Miggy Lastname | Multiplayer rhythm party game (badge hacking included) | [Devpost](https://devpost.com/software/bing-bong-z7rsny) | [GitHub](https://github.com/sophiayduan/bingbong) | [YouTube](https://youtu.be/8q17EuXBUfU) | - |
| Concerto | Daniel Chen, Ally Guo, Hansen Cheng, Nicholas Ching | what if we made hack the north into a live concert? | [Devpost](https://devpost.com/software/concerto-0wd9zs) | [GitHub](https://github.com/nicholasching/HackTheNorth) | [YouTube](https://youtu.be/N1Ge-iXepYU) | - |

What some finalists built, from their own Devpost write-ups (sources: the Devpost pages linked in the table):
- Reflex is "a robotic exoskeleton glove you can talk to, or that can learn from you". You type into Claude ("make a fist", "point"), and it drives the glove. It also collects training data for SmolVLA.
- Composition is "an AI-powered filmmaking studio that lets you physically step inside a virtual scene", capturing camera movement "using your phone".
- Concerto turns "a crowd of phones" into part of a concert's sound system, using phone screen-flash detection.
- punching-face is a "low-latency image-3D" pipeline (COLMAP, MediaPipe, Meshy, Open3D) that lets you punch a 3D rendering of a teammate's face.
- Orbis Engine reconstructs filmed video in 4D. People are masked out and inpainted with LaMa, and World Labs Marble builds a Gaussian-splat room, viewable on Meta Quest and WebXR.
- Combadge is a Star Trek-style wearable communicator (Raspberry Pi, QNX, an MPR121 touch sensor, conductive thread, GPT-6 Astra).
- TakeOne is a robotic camera and lighting film studio (LeRobot, MuJoCo, CAN bus).
- Keymaeleon is an ESP32 keyboard with OLED keys.
- bingbong is a multiplayer rhythm game built by hacking the event badges' ESP-NOW firmware.

Sponsor and category prizes (38 categories, 67 award slots). Each row's source is that project's Devpost page (winner label) plus the [gallery winners list](https://hackthenorth2026.devpost.com/project-gallery). Placing within a category is not shown on Devpost.

| Prize (sponsor: category) | Project | Team (as listed on Devpost) | One-line description (Devpost tagline) | Devpost | Code / site | Demo video |
|---|---|---|---|---|---|---|
| Aramco Americas: Best Beginner Hack | Providence | Abdalla El doumani, Hani Zaidi, Yusef Syed, Abrahim Mohamed | Providence unifies your devices and AI conversations through one superagent that carries context between tasks and coordinates work across devices simultaneously, all from a single interface. | [Devpost](https://devpost.com/software/providence-tn6m4h) | [GitHub](https://github.com/hni-z/Providence/tree/codex/htn-main) [GitHub](https://github.com/hni-z/Providence/tree/codex/voice-first) [site](https://providence.hani.so) [site](https://providence.hani.so/quest/) | [YouTube](https://youtu.be/Nec6JXXG9Cw) |
| Aramco Americas: Best Beginner Hack | Gestura | Eben Siyabalapitiya, Vanesha Budhu | Gloves that turn your movements and voice into game controls, so instead of learning the controller, the controller learns you. | [Devpost](https://devpost.com/software/gestura-6m3xfv) | [GitHub](https://github.com/Eben-Siyabalapitiya/Gestura) [site](https://eben-siyabalapitiya.github.io/Gestura/cloud_dashboard.html) | [YouTube](https://youtu.be/oqHZeFjPbFE) |
| Backboard.io: Built on Backboard | Tinker | Aman Shah | vibe code hardware | [Devpost](https://devpost.com/software/tinker-pwamby) | [GitHub](https://github.com/aman-a-shah/tinker) | [YouTube](https://youtu.be/Hl7-T8QNkPY) |
| Baseten: Best Use of Baseten | VoiceBridge | Lawrence Zou, Mir Afreed Hassan, Ricky Tang, Stephen Shao | Dysarthric speech recovery, in your own voice. | [Devpost](https://devpost.com/software/voicebridge-xh0nv9) | [GitHub](https://github.com/rickytang666/hackthenorth) | [YouTube](https://youtu.be/e1tZalE6_i8) |
| Baseten: Best Use of Baseten | neoKernel | Paarth Sharma | An agent loop that searches fusions, layouts and launch structure trying to approach the memory bandwidth floor. | [Devpost](https://devpost.com/software/neokernel) | [GitHub](https://github.com/cogniera/neoKernel) | none listed |
| Bracket Bot: Best Use of Bracket Bot Hardware | Badminbuddy | Felix Zhang, Leo Tang, Hong Yi (Eric) Wang, Radean Rashed Mohassel | Pick up birdies and stack them autonomously | [Devpost](https://devpost.com/software/badminbuddy) | none listed | [YouTube](https://youtu.be/4XYj7Ok1-_Y) |
| Bracket Bot: Best Use of Bracket Bot Hardware | PrintDnD | Matthew Chow, Jonathan Zhou, Makis Lam, Iris Choy | 3D Printing is repetitive. We built a robot that automates it. | [Devpost](https://devpost.com/software/printdnd) | [site](https://printdnd.vercel.app/) | [YouTube](https://youtu.be/HfM9EMc2IQs) |
| Bracket Bot: Best Use of Bracket Bot Hardware | GitIRL Bot | Daniel Liu, Andrew Zheng, Sarah Yoo, ryan wong | Version control for the physical world | [Devpost](https://devpost.com/software/house-bot) | [site](https://gitirl.health/) | [YouTube](https://youtu.be/FEGR3mJmXMg) |
| Bracket Bot: Best Use of Bracket Bot Hardware | Realbot | Ario Barin Ostovary, Kyle Su, David Estrine, Kevin Yan | remote tours with greater interactability | [Devpost](https://devpost.com/software/realbot) | [GitHub](https://github.com/ariobarin/RealBot) | [YouTube](https://youtu.be/EkgG5Q7dZB0) |
| Browserbase: Best Use of Browserbase | plus1 | Vaibhav Sharma, Donald Lee, Kevin Gu, Manav Joshi | plus1 joins your Google Meet with a face and a voice, is an expert in whatever you need, and can take on action items or screenshare. | [Devpost](https://devpost.com/software/plus1-1imlbz) | [GitHub](https://github.com/DonaldKLee/plus1) | [YouTube](https://youtu.be/0zWkyvdc30Y) |
| CSE: Log & Order | Minny | Calvin Lee, Alex Wu, Naman Sonawane, Faiz M | Cover your blind spots. Model behaviour, correlate anomalies | [Devpost](https://devpost.com/software/minny) | [GitHub](https://github.com/Ch33zig/Minny) | [YouTube](https://youtu.be/EaLT4MyxxX4) |
| CSE: Log & Order | Trace | ustr, Jeremy Friesen | Unsupervised log anomaly detection | [Devpost](https://devpost.com/software/loggr) | [GitHub](https://github.com/JeremyFriesenGitHub/htn26) [site](https://trace.cooking) | none listed |
| CSE: Log & Order | WatchTower | Vishnu Sai, Goshanraj Govindaraj, Hayden Choi, Umar Ahmer | Turn HTTP logs into provable, safe incident response | [Devpost](https://devpost.com/software/cadify) | [GitHub](https://github.com/Hayden9898/Hack-the-North-2026) | none listed |
| Cloudflare: Best Agent with a Brain | Whim | Lucian (Luka) Lavric, Karan Anand, John Ruttan, Sheng Chang Li | Play a game, shop for the party, or book an entire trip end to end. Whim puts custom AI-powered widgets right in your group chat. | [Devpost](https://devpost.com/software/idk-man-794g6v) | [GitHub](https://github.com/chang-07/htn-26) [site](https://whim.schangchang-li.workers.dev) | [YouTube](https://youtu.be/5nbMa-0Q6Io) |
| Cognition: Best Use of Devin | Gods Plan | Evan He, Mohammed Elshrief, Benjamin Tsang, Aaron Su | A 3D god-mode sandbox for real cities, where physics and thousands of AI agents let you break, rebuild and stress-test entire cities. | [Devpost](https://devpost.com/software/shift-t15x3m) | [GitHub](https://github.com/ManagementMO/shift) [site](http://agentsamong.us) | [YouTube](https://youtu.be/BNam7MmXBsM) |
| Composio: 6 months free subscription + $10k of credits for the 6 months | Otto | Vibhor Sharma, Aryaan Sheth, Ayush Narayanaswamy | All your apps, at your command. Just say the word and Otto already has it finished! | [Devpost](https://devpost.com/software/dean-your-personal-agent-at-your-command) | [GitHub](https://github.com/Vibhor7-7/HackTheNorth-OTTO) | [YouTube](https://youtu.be/QVRdKxlLYfg) |
| Dominion Dynamics: WHITEOUT | Shadow Stalker | Ari Khan, Malek Hammoud, Leonardo Zhou, Riyan Kassam | Shadow Stalker is a secure program that commands an aerial fleet and multiple ground assets to search for, detect, and report shadow vessels. | [Devpost](https://devpost.com/software/temp-p5ogjk) | [GitHub](https://github.com/malekhammoud/Drone-Sim) | [YouTube](https://youtu.be/6RL2bwKpjxA) |
| Dominion Dynamics: WHITEOUT | DominIQ | Savir Singh, Karan Gupta, Émilien Lavallée, Helen | 4 drones, dropped with no idea where the enemy ship is. Within minutes, it's found - using just camera geometry, and tracked by an algorithm, all while you watch in VR and clarify by voice. | [Devpost](https://devpost.com/software/dominiq) | [GitHub](https://github.com/savirsingh/DominIQ) | [YouTube](https://youtu.be/zN7Yl_UZopU) |
| Dominion Dynamics: WHITEOUT | DogWatch | Nelson Kang, Matthew Zhu | Automated system to tackle the Dominion Dynamics track | [Devpost](https://devpost.com/software/bump-pets) | [GitHub](https://github.com/Ollienel777/HTN_WHITEOUT) | none listed |
| Dryft: Dryft Company Challenge | Hedge The North | NEhnes Ehnes, J D, Abhiraj Dutta | A live, on-chain prediction market that thrives on hackathon chaos. Seamlessly bet on props with just a tap of your HTN badge. | [Devpost](https://devpost.com/software/solana-prediction-mkt) | [GitHub](https://github.com/Erenius-Valoraen/pred-market) | [YouTube](https://youtu.be/iZufLdMMyhc) |
| Elastic: Find the Signal - Best Use of Elasticsearch | hereafter | Sophia Nguyen, Rohan Saha, Angie Wang | version control for your future. | [Devpost](https://devpost.com/software/physical-studio-code) | [GitHub](https://github.com/archangelinux/hereafter) | [YouTube](https://youtu.be/G1VDjOIsy6M) |
| Elastic: Find the Signal - Best Use of Elasticsearch | PawTrace | Joey Lu | PawTrace is a missing-pet search platform that combines community sightings and available camera footage to determine where a lost pet is most likely to be. | [Devpost](https://devpost.com/software/tailsignal) | [GitHub](https://github.com/joeyhlu/htn) | [YouTube](https://youtu.be/mJMGNQhIAtM) |
| Expo: Best Mobile Experience Built with Expo | Cospray | Adarsh Thoduvakkal, Daniel L., Hamza Khan, Andrew Li | Cospray transforms the real world into a shared canvas. Paint AR graffiti on any surface, and anyone walking by can see your artwork. Permanently. Make connections & show your creativity with Cospray! | [Devpost](https://devpost.com/software/fresco-b1riws) | [GitHub](https://github.com/McMuf/htn26) | [Vimeo](https://vimeo.com/1228517458) |
| Federato: Building the Federato Insurance Agent | Pixie | Ben Zhou | the modern insurance engine | [Devpost](https://devpost.com/software/pixie-8vlj7g) | [GitHub](https://github.com/benz16107/pixie-htn2026) [site](https://pixie-underwriting.vercel.app) [site](https://pixie-underwriting.vercel.app/intact) | [YouTube](https://youtu.be/O47V32zbv20) |
| GPTZero: Best Use of GPTZero API | Sham | Lennart Schaeffer, Vennise Ho, Aryaman Pandey | Sham is a Chrome extension that helps you spot sketchy online stores before checkout by analyzing signals across Reddit, Instagram, and more, providing it all to you in one simple risk score. | [Devpost](https://devpost.com/software/cool-ppl-from-amplify) | [GitHub](https://github.com/venniseho/hack-the-north-2026) | [YouTube](https://youtu.be/8RBtLGo-Cfo) |
| GPTZero: Best Use of GPTZero API | MedBot | Caleb Lam, Fahad Sheikh, Ezekiel Joseph Miranda, Rayan Malki | MedBot turns viral health claims into evidence-backed insights and shareable videos, helping people separate hype from science. | [Devpost](https://devpost.com/software/medbot-2e40oh) | [GitHub](https://github.com/RayanMalki/htn-2026.git) [site](https://htn-2026.rayanmalki54.workers.dev/) | [YouTube](https://youtu.be/utDEHZVCYtU) |
| GPTZero: Best Use of GPTZero API | Snitch | Ivan Yeh, Bernie Liu, Amelia Lon, Karthikraj Sivakumar | Snitch helps recruiters spot suspicious moments in remote interviews by combining behavioral signals, AI-language detection, CV checks, and visual canaries. | [Devpost](https://devpost.com/software/snitch-ldyzh9) | [GitHub](https://github.com/amelialon/Snitch) [site](https://snitch-lilac.vercel.app/) | [YouTube](https://youtu.be/Yi8CKzDzxrU) |
| Huawei: OMNI Live Challenge | Octavius | Roy Lu, Dinesh Sinnathamby, Savio Joseph Benher | Extra DIY arm, made with cardboard, code, and love. | [Devpost](https://devpost.com/software/octavius-nkl4x3) | [GitHub](https://github.com/savcode066/octavius) | [YouTube](https://youtu.be/Nh9v-tnl4-o) |
| Huawei: OMNI Live Challenge | Goosetriever | Zachary Xie, Golgisoo Jafari, Jay Wen, Hao Yan | A voice-controlled robot built to help retrieve dropped objects—with multimodal AI, autonomous navigation, and a learned grasping policy, restoring daily autonomy for those with mobility challenges. | [Devpost](https://devpost.com/software/robot-pickup-helper) | [GitHub](https://github.com/dark-sorceror/Goosetriever) | [YouTube](https://youtu.be/G8Z7QbDx5YE) |
| Huawei: openJiuwen Multi-Agent Challenge | Parity | Aidan Tran, Daksh Khanna, Ken Chen | Specialized AI agents divide tasks, share knowledge, and migrate code across languages through parallel implementation and collaboration | [Devpost](https://devpost.com/software/parity-8n5zbf) | [GitHub](https://github.com/KenC2006/htn2026) | [YouTube](https://youtu.be/k8ffGmC7734) |
| Huawei: openJiuwen Multi-Agent Challenge | 蚁群 YiQun | Yifan Liu, Daniel Xu, Eddie B, Eric Feng | Over 6000 people are still missing after Nepal's landslide. Rescue teams are far too few, too slow, and too late. The robotic swarm searches faster, better, and keeps going even if it loses contact. | [Devpost](https://devpost.com/software/project-ki3u7vwhj0x8) | [GitHub](https://github.com/ImperialKoi/swarm-robotics-openJiuwen) [site](https://swarm-website-omega.vercel.app/) | [YouTube](https://youtu.be/6Lp22BUJxl0) |
| Human Computer Lab: Build with LeLamp SDK | Feel The Music | Karanvir Khanna, Mehar Khanna, Tony Qiu | A full-body immersive music experience that transforms music into synchronized light, haptics, and gesture, enabling deaf people to feel rhythm, intensity, and emotion throughout their bodies. | [Devpost](https://devpost.com/software/feel-the-music) | [GitHub](https://github.com/Karanvir1729/feelthemusic) | [YouTube](https://youtu.be/WmgGEp0IGl8) |
| Human Computer Lab: Build with LeLamp SDK | You Light, I Lift | Edison Cai, Melinn S. Chailom, Jenny Bian, Kat Wang | This is a 2D co-op game, one player aims a physical lamp to reveal the digital world, while the other controls a real stick to build platforms on screen. Neither can win alone, you light, I lift! | [Devpost](https://devpost.com/software/you-light-i-lift) | [site](https://drive.google.com/drive/folders/1qXcsC1pfsFprCtcfazmupasLdtDCj54l?usp=sharing) | [YouTube](https://youtu.be/3Xcl9w1WM0U) |
| Human Computer Lab: Build with LeLamp SDK | LeLamp Play Pack | Amy Lee, Grant Wang | Exploring Lelamp's game-making capabilities | [Devpost](https://devpost.com/software/wip-qdk9hm) | [GitHub](https://github.com/tessaSlice/lelamp-play-pack/tree/main) | [YouTube](https://youtu.be/Hx11IIzHZcw) |
| Intact: The Quoting Interface of the Future | Pixie | Ben Zhou | the modern insurance engine | [Devpost](https://devpost.com/software/pixie-8vlj7g) | [GitHub](https://github.com/benz16107/pixie-htn2026) [site](https://pixie-underwriting.vercel.app) [site](https://pixie-underwriting.vercel.app/intact) | [YouTube](https://youtu.be/O47V32zbv20) |
| Linq: Best Use of Linq | messageMAFIA | Estella Gu, Lola Sanchez | Social deduction game Mafia played in your iMessages group chat; AI story narration, roles & actions managed in DMs, group discussion in chat, polls, message effects, and more! | [Devpost](https://devpost.com/software/robot-mt8uxc) | [GitHub](https://github.com/lolasanchezz/text-mafia) | none listed |
| Linq: Best Use of Linq | Whim | Lucian (Luka) Lavric, Karan Anand, John Ruttan, Sheng Chang Li | Play a game, shop for the party, or book an entire trip end to end. Whim puts custom AI-powered widgets right in your group chat. | [Devpost](https://devpost.com/software/idk-man-794g6v) | [GitHub](https://github.com/chang-07/htn-26) [site](https://whim.schangchang-li.workers.dev) | [YouTube](https://youtu.be/5nbMa-0Q6Io) |
| MLH: Best Domain Name from GoDaddy Registry | S.L.O.P. | Neelesh Nayak, Hari Kolla, Andy Xu, Enkai Liu | Similarity Lookup for Originality Prediction | [Devpost](https://devpost.com/software/north-inc) | [GitHub](https://github.com/enkai-liu/htn-2026) [site](http://slop.compare) | [Vimeo](https://vimeo.com/1228515893) |
| MLH: Best Use of ElevenLabs | Squawk | Kavir Auluck, joeyb007 Barbosa, Ayan Bin Saif, Akishai Sabaratnasarma | An AI copilot for air traffic controllers. It plans conflict-free routes, listens to the radio with a model tuned on real ATC audio, and catches wrong pilot readbacks before they become incidents. | [Devpost](https://devpost.com/software/atc) | [site](http://squawk.fit) | [YouTube](https://youtu.be/kBiB2bNY1BI) |
| MLH: Best Use of Gemini API | Composition | Justin Lam | A physical creative harness for agentic video creation | [Devpost](https://devpost.com/software/composition) | [GitHub](https://github.com/justinlam747/Composition) | [YouTube](https://youtu.be/IDO7cJnBtp0) |
| MLH: Best Use of MongoDB Atlas | Project Orion | Daniel Zhang, Feiyang | Name a city. An AI crew plans your days on real streets, and then a magic goose flies you through them in photorealistic 3D." | [Devpost](https://devpost.com/software/project-atlas-icfow4) | [GitHub](https://github.com/Feiyang0303/Orion_HTN26) [site](https://orion-coral.vercel.app/) | [YouTube](https://youtu.be/1InwD73Dmjo) |
| MLH: Best Use of Snowflake API | PiHive | Rachel Zhang, Hadi Zaidi, Mariam ElSahhar, Taisir Hassan | Datacenter on a desk: cloud LLMs see your data and charge per token; local LLMs need pricey hardware. We split a model across $100 Raspberry Pis for machines too weak to run it alone run it together. | [Devpost](https://devpost.com/software/primacore) | [GitHub](https://github.com/mariamelsahharr/htn-2026-dist-inf) | [YouTube](https://youtu.be/3rHr03Vt5Rw) |
| MLH: Best Use of Tiger Data | Save My Rims | IL800092 Luk, Younghoon (Brian) Kim, Armaan C, George Kassir | Hate potholes? Damaged wheels? We got you! | [Devpost](https://devpost.com/software/detect-pot) | [GitHub](https://github.com/Georgeyy07/HackTheNorth2026) [site](https://savemyrims.health/?drive=kaggle_fixture&profile=original) | [YouTube](https://youtu.be/XApMMhYx4as) |
| MLH: Best Use of Vultr | Triviality | Roshan iruku, Akshay Gupta, Ronnie Gu, Sharon Basovich | Agent swarms for math proofs. | [Devpost](https://devpost.com/software/rbc-buddies) | [GitHub](https://github.com/sharonbasovich/norththehackers/tree/main) [site](https://triviality-psi.vercel.app/) | [YouTube](https://youtu.be/JoDcHAMOXgo) |
| OpenAI: API Prizes | Granny Waymo | Ryushen Tan, bohan wang, qasim l., Evan Chiu | Turn your Grandma into a Waymo | [Devpost](https://devpost.com/software/granny-waymo) | [GitHub](https://github.com/0vp/htn-2026) | [YouTube](https://youtu.be/yq3226qKDLE) |
| OpenAI: API Prizes | Aircade | Adyan Ullah, Yegor Zaytsev, Farhad Sadig | we hacked the apple airpods SDK to build a wii remote that fits in the palm of your hands and lets you play against state of the art AI models. | [Devpost](https://devpost.com/software/aircade-m4n6zv) | [GitHub](https://github.com/apollo-ullah/Aircade) | [YouTube](https://youtu.be/xdL29Ifvi_A) |
| OpenAI: API Prizes | Orbis Engine | Daniel Pu, Aayan Karmali, James Li, Austin Jian | Anything ever filmed, in 4D. | [Devpost](https://devpost.com/software/temp-jcyltx) | [GitHub](https://github.com/dtpu/OrbisEngine) | [YouTube](https://youtu.be/fvC2Ax81VGE) |
| QNX: Create an Embedded System with QNX that Uses AI | EyeMelody | Pranay Soni, Ali Abzakh, Alessandro D'Amore, pravoslavzilka Žilka | Anyone, playing anything, anywhere! | [Devpost](https://devpost.com/software/dual-vision-glasses) | [GitHub](https://github.com/pravoslavzilka/htn-gaze) | [YouTube](https://youtu.be/8T5pSdE79tU) |
| QNX: Create an Embedded System with QNX that Uses AI | SpideyIRL | Noah Valentin Klaholz, Chris Dietrich, Aditya Padmarajan, Halie Favron | The Real Life Peter Tingle | [Devpost](https://devpost.com/software/sixth-sense-pk24ul) | [GitHub](https://github.com/adi-padmarajan/SpideyIRL) | [YouTube](https://youtu.be/9_8m-XiTdOw) |
| QNX: Create an Embedded System with QNX that Uses AI | Combadge | Dan (Dang Khoa) Chiem, Edmon Shi, Samuel Martineau, Alex Huang | Inspired by Star Trek’s combadge and ship’s computer: a wearable AI communicator combining voice, vision, and actions. Just say, “Computer.” | [Devpost](https://devpost.com/software/combadge) | [GitHub](https://github.com/orgs/Combadge-HTN/repositories) | [YouTube](https://youtu.be/ZbD7XTCFx-I) |
| RBC: Signal in the Noise | FinRet | Ridaan Gupta, Pravin P., Wasi Rehman | An evidence-first finance research harness that uses AI to deliver fully auditable, citation-backed financial insights. | [Devpost](https://devpost.com/software/finret) | [GitHub](https://github.com/pravinpaudel/ai-harnesss-htn-2026) | none listed |
| RBC: Signal in the Noise | Signal | Eric Chen, Arhum Nouman, Liam Ma | Multi-agent research that cites its sources and flags conflicts. | [Devpost](https://devpost.com/software/temp-project-0sp3zv) | [GitHub](https://github.com/liamma06/searchGM/tree/main) | [YouTube](https://youtu.be/uoozwdHRqZA) |
| Rox: Best AI Agent | AdLib | Marcus Ng, James Cai | Live voice and action reactive canvas for the future of presentations | [Devpost](https://devpost.com/software/living-canvas-gz360v) | [GitHub](https://github.com/Marcus990/adlib) | [YouTube](https://youtu.be/7rFWjY7Ly7k) |
| Rox: Best AI Agent | Jevis | Ian Leung, patrick wei, Aaron Ye, evan yang | Run your browser agents faster-- at a fraction of the cost. | [Devpost](https://devpost.com/software/skillweaver) | [GitHub](https://github.com/evanzyang91/htn-2026) | none listed |
| Sentry: Best Use of Sentry | punching-face | Akash Nagabhirava, Mark Peng, Seeron Sivashankar, Jace Mu | punch ur face | [Devpost](https://devpost.com/software/punchface) | [GitHub](https://github.com/akashngb/punching-face) | [YouTube](https://youtu.be/wWvFjsOJgjA) |
| Sentry: Best Use of Sentry | ChatGPU | Phineas Truong, Ethan Qiu, Jack Le, ji24077 Han | Agent for adapting, optimizing, and running code on any machine, anywhere. | [Devpost](https://devpost.com/software/ji-review) | [GitHub](https://github.com/ji24077/HTN) | [YouTube](https://youtu.be/0Jx7tl-mJ9Y) |
| Sentry: Best Use of Sentry | HumanCraft | Adrian Shahnazari, Tri Nguyen, Elijah Zhao, Jonathan Zhu | Bringing real humans into Minecraft using iPhone LiDAR, creating 3D point clouds with accurate body hitboxes. | [Devpost](https://devpost.com/software/humancraft) | [GitHub](https://github.com/elijahzhao24/minecraft_hack_the_north) | [YouTube](https://youtu.be/qKX6S8JOmR0) |
| Shopify: Hack Shopping with AI | Bloxify | Andrew Law | Agentic and analytics layer for selling with Shopify on Roblox | [Devpost](https://devpost.com/software/bloxify) | [GitHub](https://github.com/werdna533/Bloxify) | none listed |
| Shopify: Hack Shopping with AI | Dealify | Bryan Maristanez, Ritvik Goyal, Ricardo Gao | An AI shopkeeper for Shopify that helps shoppers find products and negotiate deals within merchant-set pricing rules. Test those rules on 300 synthetic shoppers before adopting them. | [Devpost](https://devpost.com/software/bazaar-wgv16i) | [GitHub](https://github.com/Maristanez/bazaar) [site](https://b8wzw0-h3.myshopify.com) | [YouTube](https://youtu.be/6Dw70vbZ_Zs) |
| Solana: Best Use of Solana and Badge Hack | Settlers of Solana | Kyle Wang, Nigel Loh, Yiming Su | Swarm of AI agents simulates a free-market economy on Solana. | [Devpost](https://devpost.com/software/_solanasim) | [GitHub](https://github.com/leakyhose/agent-economy) | [YouTube](https://youtu.be/2_bnZhsAtcY) |
| Solana: Best Use of Solana and Badge Hack | Among Us | Lily Song, Yanzi Guo, davidliu Liu | Among us but IRL | [Devpost](https://devpost.com/software/among-us-lbrwjk) | [GitHub](https://github.com/s-illly/htn-amongus) | none listed |
| Tether: The Best Sovereign App | Aegishmesh | Sathvik H, Aabel Eldo, Sathvik Haridasu, Asma Ahmed Syrotkin | A sovereign AI security mesh that detects threats, coordinates autonomous agents, and enforces safe actions in real time. | [Devpost](https://devpost.com/software/aegismesh-oj813b) | [GitHub](https://github.com/asma675/Hack-the-North-2026) | [YouTube](https://youtu.be/z-jlB5tFR3A) |
| Tether: The Best Sovereign App | Agentigram | Parth Bhasin, Aryaman Sharma, Pierce Luu, Vishnu Ajit | Where coding agents coordinate, ship, and manage themselves. | [Devpost](https://devpost.com/software/clankergram) | [GitHub](https://github.com/ParthB21/agentigram) | [YouTube](https://youtu.be/zHZ-s3DZo_g) |
| Unto Labs: Best Use of Thru | fly VS worm | Marc Da Silva, Jeremy Siu, Neo Prohnitchi | Ethical and Legal Crypto Sim | [Devpost](https://devpost.com/software/fly-vs-worm) | [GitHub](https://github.com/MarcDasilva/htn-2026) [site](http://flyvsworm.biz) | [YouTube](https://youtu.be/uWx6xYoPXUY) |
| Warp: Best Developer Tool by Warp | ARDB: AR Debugger | Kenny Zheng, Jeffrey Zhu, Sujay Golla, Grant O | Augmented Reality debugging tool. Spatial diagnostics for embedded systems. | [Devpost](https://devpost.com/software/ardb) | [GitHub](https://github.com/ColonelParrot/ardb-web) [GitHub](https://github.com/PyneKoyne/AR-Debugger/) | [YouTube](https://youtu.be/lSqLyfDsvgU) |
| Zip: Best Use of Zip | YourCall | Alyssa Yuan, Renee Xu, Leo Jia | turn a message into enterprise action. | [Devpost](https://devpost.com/software/yourcall-0epzc4) | [GitHub](https://github.com/leojia8/YourCall) | [YouTube](https://youtu.be/0poH1JGydeM) |
| Zip: Best Use of Zip | Agent-Gate | Aaryan Paiva, Japneet Singh, Megh Joshi | A policy firewall for AI agents. Whatever your enterprise cares about, AgentGate checks it on your Enterprise Production Agent and steps in before anything runs. | [Devpost](https://devpost.com/software/agent-wall-hqrjvb) | [GitHub](https://github.com/japneet250/Agent-Gate) | none listed |

Prize rewards as stated in the official Devpost prize descriptions (the page labels all 39 as "non-cash prizes", though several descriptions name cash amounts) — [Devpost prizes](https://hackthenorth2026.devpost.com/):
- OpenAI: API Prizes (3 winners). "First, second, and third place will go to the strongest projects across both areas" (what was built with the OpenAI API, and how Codex helped build it).
  - 1st Place: "Lunch or Dinner with OpenAI Recruiters & Engineers, ChatGPT Pro Subscriptions, OpenAI Swag Bundle".
  - 2nd Place: "ChatGPT Pro Subscriptions, OpenAI Swag Bundle".
  - 3rd Place: "OpenAI Backpack & T-Shirt".
- GPTZero (3 winners):
  - 1st: AirPods Pro 3, premium swag and $2000 of GPTZero credits per teammate.
  - 2nd: swag and $500 of credits per teammate.
- QNX (3 winners): 1st $1500, 2nd $500, 3rd $500.
- Dryft (1 winner): $2000 for the fastest correct implementation.
- Elastic (2 winners): 1st Meta Quest 3S, 2nd Bose QuietComfort headphones.
- Baseten (2 winners):
  - Grand Prize: a trip to SF, final-round interviews, $200 of credits and a signed book, per team member.
  - Runner-up: AirPods 4, $100 of credits and the book.
- Tether (2 winners): 1,000 USD and 500 USD.
- Dominion Dynamics WHITEOUT (3 winners): $2,000, $1,000 and $500, plus guaranteed first-round interviews.
- Bracket Bot (4 winners):
  - 1st: 4x Bambu Lab A1 Mini and 4x SO-101 leader-follower kits.
  - 2nd: 4x SO-101 kits.
  - 3rd: 4x SO-101 follower robots.
- Sentry (3 winners): guaranteed interviews.
- Human Computer Lab (3 winners): a Bambu A1 printer and a LeLamp per team.
- Huawei openJiuwen and OMNI Live (2 winners each): Huawei Watch GT 6 (1st) or FreeClip 2 earbuds (2nd), plus internship-interview or office-tour perks.
- Warp (1 winner): Keychron keyboards.
- Expo (1 winner): $150 and swag per teammate.
- Intact (1 winner): $100 gift cards and an interview opportunity.
- Backboard.io (1 winner): internship interviews and $400 per team.
- Shopify (2 winners): Shop Cash per person.
- RBC (2 winners): a Kodak PIXPRO camera (Best Business Value) and a Wooting 80HE keyboard (Top Tech Performance).
- Aramco Americas Best Beginner Hack (2 winners): open to teams whose members had attended at most one prior hackathon.
- MLH ElevenLabs: wireless earbuds.

### Inferences
- Gallery order in the winners list is not a ranking. Devpost shows no placings within categories, so "who got 1st in OpenAI or GPTZero" cannot be read from the official results.
- Many finalists are hardware or physical-interaction projects: Combadge, Reflex, TakeOne, Keymaeleon and bingbong are hardware builds, and Composition and Concerto use phones as physical interfaces. This fits HTN's stated taste for "playful, experimental, wonderfully weird" projects. Aircade, a playful physical-interaction game, was not picked as a finalist.

### Gaps
- Placings inside the multi-winner sponsor categories (OpenAI, GPTZero, QNX, Elastic, Baseten, Tether, Dominion Dynamics, Bracket Bot, Huawei, RBC) are not on Devpost.
- Team-member lists are as entered on Devpost and may omit teammates who never joined the Devpost entry. Several entries show only handles or first names.

## Is there a Hack the North 2026 project that used AirPods (or another wearable) motion data as a game controller or "Wii remote"? What is it called, who built it, and what did it win?

### Takeaway
Yes: **Aircade**, by Adyan Ullah, Yegor Zaytsev and Farhad Sadig. It turns a single AirPod into a Wii-style handheld motion controller for a native Mac arcade (tennis, Neon Rush, Saber Duel) played against AI opponents. It uses Apple Core Motion's CMHeadphoneMotionManager.

What it won, officially: one sponsor prize, **"OpenAI: API Prizes"**, as one of that prize's three winners (the others were Granny Waymo and Orbis Engine).
- It was **not** one of the 12 Hack the North finalists (the top overall award), and it won no other prize.
- Devpost does not say which OpenAI place it took.
- Social posts seen only through search snippets say "3rd place in the OpenAI track" and "Top 30 Semifinalist". Posts about Granny Waymo likewise claim 1st for that project, which fits Aircade being 3rd. If it was 3rd, the official reward listed for 3rd is an "OpenAI Backpack & T-Shirt".

A second AirPod-as-Wii-controller project, **Poddle** (pickleball), was also submitted but won nothing.

### Cited Findings
Official (organizer-entered Devpost data):
- Aircade's Devpost tagline: "we hacked the apple airpods SDK to build a wii remote that fits in the palm of your hands and lets you play against state of the art AI models." The project page shows "Submitted to Hack the North 2026 — Winner — OpenAI: API Prizes" and no other award. — [Aircade on Devpost](https://devpost.com/software/aircade-m4n6zv) (fetched 2026-11-07)
- Team on Devpost:
  - Adyan Ullah ([devpost.com/apollo-ullah](https://devpost.com/apollo-ullah)). His team-card note reads "placed 2nd on the leaderboard".
  - Yegor Zaytsev ([devpost.com/yegorzaytsevbusiness](https://devpost.com/yegorzaytsevbusiness)).
  - Farhad Sadig ([devpost.com/farhad951](https://devpost.com/farhad951)).
  - Built with: baseten, codex, core-motion, gpt-6-astra, openai, solana, swift, vercel, vision.
  - The Devpost project was started Sep 19, 2026, 12:20 PM EDT.
  - Links: [GitHub](https://github.com/apollo-ullah/Aircade) and the embedded [demo video](https://www.youtube.com/watch?v=xdL29Ifvi_A). — [Aircade on Devpost](https://devpost.com/software/aircade-m4n6zv)
- The gallery's winners list has three entries for "OpenAI: API Prizes": Granny Waymo ("Turn your Grandma into a Waymo"), Aircade, and Orbis Engine (also a finalist). Aircade is not among the 12 entries labelled "Hack the North 2026: Finalists", and the museum's 2026 finalist collection does not include it. — [Devpost gallery](https://hackthenorth2026.devpost.com/project-gallery); [museum.hackthenorth.com](https://museum.hackthenorth.com/)
- OpenAI prize terms: build with the OpenAI API "with Codex as your development teammate". Entries were assessed on what was built with the API and how Codex helped. "First, second, and third place will go to the strongest projects across both areas." Rewards: 1st, a lunch or dinner with OpenAI recruiters and engineers plus ChatGPT Pro and swag; 2nd, ChatGPT Pro and swag; 3rd, an OpenAI backpack and T-shirt. — [Devpost prizes](https://hackthenorth2026.devpost.com/)

How it works (team's own Devpost write-up and repository):
- Devpost write-up:
  - "So we turned an AirPod into a Wii-style motion controller and built an arcade around it. Pick up an earbud. Tilt it to navigate. Swing it like a tennis racket. Challenge an AI opponent, slice through Neon Rush, or connect an iPhone and duel your friend."
  - Built "natively with Swift, SwiftUI, SceneKit, and Core Motion". Calibrating sets the AirPod's current orientation as neutral, and "rotating the earbud rotates the racket in-game".
  - "Because headphone motion gives us rotation rather than absolute hand position, optional camera tracking can provide a separate position signal. The public headphone API also only gives us one active AirPods motion stream at a time, so our two-player mode pairs an AirPod with an iPhone."
  - Opponents: "Astra" via the OpenAI API (game state plus five legal returns go to the model), and a Codex computer-use mode that plays through the visible game window. — [Aircade on Devpost](https://devpost.com/software/aircade-m4n6zv)
- GitHub README:
  - "We turned an AirPod into a Wii-style motion controller—and built an arcade where humans and AI can play through different interfaces." "Built at Hack the North 2026 with Swift, SwiftUI, SceneKit, Core Motion, the OpenAI Responses API, and Codex."
  - Its comparison of Astra (OpenAI API) and Jev (Vercel AI Gateway), recorded September 20, 2026: 40/40 valid decisions each, with median request times of 1,836.5 ms and 322 ms.
  - "One active headphone motion stream led us to use an iPhone as the second controller in Saber Duel." — [Aircade README](https://github.com/apollo-ullah/Aircade/blob/main/README.md)
- Code: Sources/Aircade/MotionModel.swift declares `final class MotionModel: NSObject, ObservableObject, CMHeadphoneMotionManagerDelegate`, creates `CMHeadphoneMotionManager()` and calls `startDeviceMotionUpdates(to:)`. This is Apple's public AirPods head-tracking API, not a private SDK hack. — [MotionModel.swift](https://github.com/apollo-ullah/Aircade/blob/main/Sources/Aircade/MotionModel.swift)
- Repository metadata (gh API, 2026-11-07):
  - Created 2026-09-19T09:19 UTC (first commit 09:19:16 UTC, inside the event's code window). Last push 2026-09-24. 2 stars, no license.
  - Description: "Aircade is a motion-controlled arcade for Mac, powered by the sensors in your AirPods. Play against state of the art AI models like TypeSafe's JEV or GPT-6 Astra."
  - Contributors: apollo-ullah (83 commits), yegorza (9), farhad-sadig1 (1).
  - Commits on Sep 20 include "Prevent duplicate public leaderboard names" and "Keep leaderboard navigation inside Aircade". — [GitHub repo](https://github.com/apollo-ullah/Aircade); [commits](https://github.com/apollo-ullah/Aircade/commits/main)
- Demo video: "Aircade Demo" on channel "Yegor Zay", uploaded 2026-09-19 21:46 PT, 54 seconds, 172 views on 2026-11-07. The README notes the 54-second video "predates some of those additions". — [YouTube](https://www.youtube.com/watch?v=xdL29Ifvi_A)

Second-hand (social media, could not be verified directly):
- Search-engine summaries of LinkedIn pages describe posts saying:
  - Aircade "won 3rd place in the OpenAI track".
  - Another post says it placed as a "Top 30 Semifinalist" and won in the OpenAI track "out of 350+ projects".
  - Some posts call it the OpenAI track "winner".
  - The posts also claim the team "hacked the AirPods motion SDK to support up to 8 players with sub-30 ms latency" and added haptic feedback through a TITAN Haptics wristband.
  - The pages surfaced were profiles of Hamza Zaidi, Yeonjae Oh, Jerry Luo, Antoine Saade and Kamil Bafia (TITAN Haptics), not the three Devpost team members, so these are probably posts those people reacted to or reshared. Every LinkedIn URL returned HTTP 999, so I could not read the posts or their dates. — [LinkedIn: Hamza Zaidi](https://www.linkedin.com/in/hmzzaidi/), [Yeonjae Oh](https://www.linkedin.com/in/yeonjae-oh-9497b9293/), [Jerry Luo](https://www.linkedin.com/in/jerry-luo-a7b6972b6/), [Antoine Saade](https://www.linkedin.com/in/antoine-saade-249023374/), [Kamil Bafia](https://www.linkedin.com/in/kamil-bafia/) (all via search snippets only)
- Co-winner placing claims (also second-hand, LinkedIn via search summaries only):
  - Posts about Granny Waymo say "We turned your grandma into a Waymo at Hack the North and it won us 1st place on the OpenAI track". Granny Waymo's own Devpost write-up confirms the build (a Codex-assisted robot wheelchair that uses a hacked Hack the North badge as a controller) but not the placing.
  - Orbis Engine team member Austin Jian's portfolio calls it only a "hack the north '26 finalist", with no OpenAI placing.
  - Sources: [LinkedIn: Isaac Ho](https://www.linkedin.com/in/isaac-ho-07a458213/), [Aaron Yang](https://www.linkedin.com/in/aaron-yang-9b0767269/) and [Ryan Zhang](https://www.linkedin.com/in/ryanzhang-link/) (search snippets only; these may not be the posts' authors); [Granny Waymo on Devpost](https://devpost.com/software/granny-waymo); [austinjian.ca](https://www.austinjian.ca/) (fetched 2026-11-07)
- The "8 players" claim conflicts with the team's own Devpost and README, which say the public API gives "one active AirPods motion stream at a time" and that two-player mode pairs an AirPod with an iPhone. Neither the Devpost write-up nor the README mentions TITAN Haptics, a wristband or haptics. — [Aircade on Devpost](https://devpost.com/software/aircade-m4n6zv); [README](https://github.com/apollo-ullah/Aircade/blob/main/README.md)

Other HTN 2026 projects using AirPods, phones or wearables as motion controllers (official Devpost data):
- **Poddle** (Harry Y, Daniel Tan, Felix Jeong): "A laptop Pickleball experience with AirPod motion tracking!" It "transforms an AirPod into a motion controller for a Wii-style pickleball game. Players connect their AirPods to a computer, hold one in their hand, and swing as if they were holding a real paddle." Site: [poddle.club](http://poddle.club). No prize, no video. — [Poddle on Devpost](https://devpost.com/software/wip-zdq95m)
- **Gestura** (Eben Siyabalapitiya, Vanesha Budhu): "Gloves that turn your movements and voice into game controls". The team built "two wearable controllers using ESP32-S3 microcontrollers, IMUs, and touch sensors mounted onto gloves", demoed with Minecraft. Eben's team note says the firmware "turns hand motion into a Bluetooth keyboard and mouse". Won "Aramco Americas: Best Beginner Hack". [GitHub](https://github.com/Eben-Siyabalapitiya/Gestura), [video](https://youtu.be/oqHZeFjPbFE). — [Gestura on Devpost](https://devpost.com/software/gestura-6m3xfv)
- **Goose Gone Loose** (Melody Wang, Elin Zhang, ditripy Robel, Jennifer Chen): "turns your iPhone's accelerometer into a Wii-style motion controller for an endless runner" (Godot). No prize. — [Devpost](https://devpost.com/software/goose-gone-loose)
- **Bearlympics** (Nathan Wan, James Yang): a party game where "your phone becomes a motion controller". No prize. — [Devpost](https://devpost.com/software/bckyrd)
- **RePlay** (anushka punukollu, Tanvi B, mané, Nahl Farhan): "turns rehab into motion-controlled games, using wearable sensors" (ESP32 and IMU). No prize. — [Devpost](https://devpost.com/software/test-ohd6si)
- **EchoPath** (Aryan Acharya): iPhone walking navigation for blind pedestrians using "airpods spatial audio guiding". Not a controller, no prize. — [Devpost](https://devpost.com/software/echo-path)
- A keyword scan of all 349 gallery names and taglines (airpod, earbud, headphone, head-tracking, wii, motion control, gyro, IMU, accelerometer, wearable, haptic, watch) found no other AirPods-controller entries. — [Devpost gallery](https://hackthenorth2026.devpost.com/project-gallery)

### Inferences
- Aircade is almost certainly the project the user remembers: a 2026 HTN winner that literally markets itself as an AirPods "wii remote". Its accurate status is "sponsor-prize winner (OpenAI API Prizes), not an overall finalist".
- Aircade's "hacked the apple airpods SDK" is marketing. The code uses the public CMHeadphoneMotionManager API, which gives one headphone motion stream per host. That is why the second player uses an iPhone's own motion sensors.
- The "placed 2nd on the leaderboard" note on Adyan Ullah's Devpost card is not an official placing. Aircade had its own public in-game leaderboards (see the commits), so it most likely refers to that, or to an HTN badge or quest leaderboard. It should not be read as 2nd place in the OpenAI prize, especially since social posts say 3rd.
- Taken together, the unverified social claims give: Granny Waymo 1st (its posts), Aircade 3rd (posts about Aircade), and so Orbis Engine 2nd by elimination. On that reading, Aircade's reward was the 3rd-place "OpenAI Backpack & T-Shirt". None of these placings appears in official HTN or Devpost data.

### Gaps
- Devpost does not show Aircade's placing within the OpenAI prize. The "3rd place" and "Top 30 Semifinalist" claims come only from LinkedIn posts seen through search summaries. The posts themselves, their authors and dates could not be read (HTTP 999).
- The "8 players / sub-30 ms / TITAN Haptics wristband" claims could not be checked and conflict with the team's own write-up.
- I found no first-hand statement from the three Devpost team members about the placing.

## If no such project appears at Hack the North 2026, did a similar project appear at Hack the North 2025 or another 2025-2026 hackathon?

### Takeaway
The fallback is not needed, because Aircade is a confirmed HTN 2026 winner. Still, several similar projects could be mixed up with it:
- Poddle at HTN 2026 (no prize).
- A different "AIRCADE" built in October 2026 at a hackathon its repo calls "MRU Hacks", which also uses AirPods head motion.
- Oscar Creates' AirPods-case "Wiimote-style" Mac mouse, covered by WatchGeneration on Nov 5, 2026. It is not a hackathon project.
- RidePods, an App Store game steered with AirPods (Hacker News, Sep 2025).

HTN 2025's Devpost gallery shows no AirPods or motion-controller projects in its names and taglines.

### Cited Findings
- HTN 2025 gallery: 260 projects (54 winner-flagged). A keyword scan of names and taglines (airpod, earbud, headphone, head-tracking, wii, motion control, gyro, accelerometer) found no AirPods or motion-controller entries. The only matches were false positives such as "simulation". — [Hack the North 2025 Devpost gallery](https://hackthenorth2025.devpost.com/project-gallery) (fetched 2026-11-07)
- "AIRCADE" (repository aj0khi/aircade-mru-hacks, created 2026-10-24, last pushed 2026-10-25):
  - "Classic cabinets. AirPods as the controller." "Hackathon theme: Revitalize."
  - Turns AirPods into a motion controller for five browser games (Pong, Snake, Breakout, Bowling, Neon Tanks).
  - Uses Swift, CoreMotion and `CMHeadphoneMotionManager` streamed over a local WebSocket.
  - It is a different team and hackathon from HTN's Aircade, despite the same name. — [GitHub: aj0khi/aircade-mru-hacks](https://github.com/aj0khi/aircade-mru-hacks)
- WatchGeneration (Pierre Dandumont, Thursday Nov 5, 2026, 11:48), headline "Un boîtier d'AirPods peut contrôler le curseur de votre Mac comme la Wiimote":
  - "Oscar" shows an app that uses an AirPods case, with the earbuds inside, to control a Mac cursor like a Wiimote, using the earbuds' head-tracking sensors.
  - The app "devrait être proposée en open source".
  - There is no mention of Hack the North or any hackathon. — [WatchGeneration](https://www.watchgeneration.fr/audio/2026/11/un-boitier-dairpods-peut-controler-le-curseur-de-votre-mac-comme-la-wiimote-20499)
- The video the article cites is "I turned my airpod case into a mouse" by Oscar Creates. — [YouTube](https://www.youtube.com/watch?v=BQcPnHVFTZQ)
- Hacker News post "I built and launched the first AirPods-Controlled Game" by tanis46, 2025-09-24 16:09 UTC, links to "RidePods: Race with Head" on the App Store. No hackathon is mentioned. — [Hacker News](https://news.ycombinator.com/item?id=45362365); [App Store](https://apps.apple.com/us/app/ridepods-race-with-head/id6752268828)

### Inferences
- The user's memory ("this year", Hack the North, AirPods as Wii remotes, a winner) matches Aircade closely. If they remember it as an overall winner or finalist, that part is wrong: it was a sponsor-prize (OpenAI) winner. If they remember a pickleball game, that was Poddle, which won nothing.
- The Nov 5, 2026 WatchGeneration story about Oscar's AirPods-case "Wiimote" is recent and could blend with memories of Aircade, but it is unrelated to HTN.

### Gaps
- The HTN 2025 scan covered only names and taglines, not full descriptions.
- I did not identify which institution runs "MRU Hacks" (the name suggests Mount Royal University, Calgary; not verified), and I did not check whether that AIRCADE won anything there.
- Other 2025-2026 hackathons (for example on Devpost generally) were not searched exhaustively for AirPods controllers.
