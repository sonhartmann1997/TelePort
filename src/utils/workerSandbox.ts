import {
  ConsoleLogEntry,
  KVItem,
  WorkerRequestData,
  WorkerResponseData,
} from '../types/worker';

export interface SimulatedTelegramBotMessage {
  id: number;
  method: string;
  chatId: string | number;
  text: string;
  photoUrl?: string;
  videoFileId?: string;
  parseMode?: string;
  replyMarkup?: {
    inline_keyboard?: Array<
      Array<{
        text: string;
        callback_data?: string;
        url?: string;
        web_app?: { url: string };
        switch_inline_query_current_chat?: string;
      }>
    >;
  };
  timestamp: string;
}

const telegramOutboxListeners: Array<(messages: SimulatedTelegramBotMessage[]) => void> = [];
let simulatedTelegramOutbox: SimulatedTelegramBotMessage[] = [];
let nextTelegramMsgId = 1000;

export function getSimulatedTelegramOutbox(): SimulatedTelegramBotMessage[] {
  return simulatedTelegramOutbox;
}

export function clearSimulatedTelegramOutbox(): void {
  simulatedTelegramOutbox = [];
  telegramOutboxListeners.forEach((fn) => fn(simulatedTelegramOutbox));
}

export function subscribeSimulatedTelegramOutbox(
  listener: (messages: SimulatedTelegramBotMessage[]) => void
): () => void {
  telegramOutboxListeners.push(listener);
  return () => {
    const idx = telegramOutboxListeners.indexOf(listener);
    if (idx !== -1) telegramOutboxListeners.splice(idx, 1);
  };
}

function recordSimulatedTelegramCall(method: string, payload: any): any {
  const chatId = payload?.chat_id ?? '100998877';
  const text = String(payload?.text ?? payload?.caption ?? '');
  const replyMarkup = payload?.reply_markup
    ? typeof payload.reply_markup === 'string'
      ? JSON.parse(payload.reply_markup)
      : payload.reply_markup
    : undefined;

  if (method === 'editMessageText' || method === 'editMessageCaption') {
    const targetMsgId = Number(payload?.message_id || 0);
    const existingIdx = simulatedTelegramOutbox.findIndex((m) => m.id === targetMsgId);
    const updatedMsg: SimulatedTelegramBotMessage = {
      id: targetMsgId || ++nextTelegramMsgId,
      method,
      chatId,
      text,
      photoUrl:
        existingIdx !== -1 ? simulatedTelegramOutbox[existingIdx].photoUrl : undefined,
      parseMode: payload?.parse_mode,
      replyMarkup,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    if (existingIdx !== -1) {
      simulatedTelegramOutbox = [
        ...simulatedTelegramOutbox.slice(0, existingIdx),
        updatedMsg,
        ...simulatedTelegramOutbox.slice(existingIdx + 1),
      ];
    } else {
      simulatedTelegramOutbox = [...simulatedTelegramOutbox, updatedMsg];
    }
    telegramOutboxListeners.forEach((fn) => fn(simulatedTelegramOutbox));
    return { ok: true, result: { message_id: updatedMsg.id, chat: { id: chatId }, text } };
  }

  if (
    method === 'sendMessage' ||
    method === 'sendPhoto' ||
    method === 'sendVideo' ||
    method === 'sendDocument'
  ) {
    const msgId = ++nextTelegramMsgId;
    const newMsg: SimulatedTelegramBotMessage = {
      id: msgId,
      method,
      chatId,
      text:
        text ||
        (method === 'sendVideo'
          ? `🎬 Video-Stream gesendet (${payload?.video || 'file_id'})`
          : method === 'sendDocument'
            ? `📄 Datei/Untertitel gesendet (${payload?.document || 'file_id'})`
            : ''),
      photoUrl: typeof payload?.photo === 'string' ? payload.photo : undefined,
      videoFileId: typeof payload?.video === 'string' ? payload.video : undefined,
      parseMode: payload?.parse_mode,
      replyMarkup,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    simulatedTelegramOutbox = [...simulatedTelegramOutbox.slice(-40), newMsg];
    telegramOutboxListeners.forEach((fn) => fn(simulatedTelegramOutbox));
    return {
      ok: true,
      result: {
        message_id: msgId,
        chat: { id: chatId, type: String(chatId).startsWith('-') ? 'supergroup' : 'private' },
        text: newMsg.text,
      },
    };
  }

  if (method === 'deleteMessage') {
    const targetMsgId = Number(payload?.message_id || 0);
    simulatedTelegramOutbox = simulatedTelegramOutbox.filter((m) => m.id !== targetMsgId);
    telegramOutboxListeners.forEach((fn) => fn(simulatedTelegramOutbox));
    return { ok: true, result: true };
  }

  if (method === 'getMe') {
    return {
      ok: true,
      result: {
        id: 77889900,
        is_bot: true,
        first_name: 'Streamflix Movie Bot',
        username: 'StreamflixMovieBot',
      },
    };
  }

  return { ok: true, result: true };
}

// Curated German TMDb dataset for instant offline/sandbox simulation of STREAMFLIX & Bot
const SIMULATED_TMDB_MOVIES = [
  {
    id: 157336,
    media_type: 'movie',
    title: 'Interstellar',
    original_title: 'Interstellar',
    release_date: '2014-11-05',
    vote_average: 8.7,
    vote_count: 35820,
    popularity: 980.5,
    runtime: 169,
    genre_ids: [878, 18, 12],
    genres: [
      { id: 878, name: 'Sci-Fi' },
      { id: 18, name: 'Drama' },
      { id: 12, name: 'Abenteuer' },
    ],
    poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    backdrop_path: '/xJHokMbljvjADYdit5fK5VQsXEG.jpg',
    overview:
      'Ein Team von Entdeckern reist durch ein neu entdecktes Wurmloch im Weltraum, um das Überleben der Menschheit auf einem fernen Planeten zu sichern.',
    fsk: 'FSK 12',
    trailerKey: 'zSWdZVtXT7E',
    production_companies: [
      { id: 174, name: 'Warner Bros. Pictures' },
      { id: 4, name: 'Paramount Pictures' },
    ],
    production_countries: [{ iso_3166_1: 'US', name: 'USA' }],
    credits: {
      cast: [
        { id: 10297, name: 'Matthew McConaughey', character: 'Cooper', profile_path: '/e9ZHRY5toiBZCIPEEyvOG9A8ers.jpg' },
        { id: 1813, name: 'Anne Hathaway', character: 'Amelia Brand', profile_path: '/tLelKoPNiyJCSEtQTz1FGv4TLGc.jpg' },
        { id: 83002, name: 'Jessica Chastain', character: 'Murph', profile_path: '/bXFXD9bf9S6kC3Y6R3x1yL22r5l.jpg' },
        { id: 3895, name: 'Michael Caine', character: 'Professor Brand', profile_path: '/bVZRMlpjTAO2pJK6v90buFgVbSW.jpg' },
        { id: 1892, name: 'Matt Damon', character: 'Dr. Mann', profile_path: '/At3JgvaNeEN4Z4ESKlhhes85Xo3.jpg' },
        { id: 1190668, name: 'Timothée Chalamet', character: 'Young Tom', profile_path: '/BE2sdjpgsa2rNTFa66f7upkaOP.jpg' },
      ],
      crew: [{ id: 525, name: 'Christopher Nolan', job: 'Director', profile_path: '/xuAIuYSmsUzKlUMBFGVZaWsY3DZ.jpg' }],
    },
    providersFlatrate: ['Netflix', 'Amazon Prime Video'],
    providerIds: [8, 9],
  },
  {
    id: 603,
    media_type: 'movie',
    title: 'Matrix',
    original_title: 'The Matrix',
    release_date: '1999-03-31',
    vote_average: 8.7,
    vote_count: 25400,
    popularity: 890.2,
    runtime: 136,
    genre_ids: [28, 878],
    genres: [
      { id: 28, name: 'Action' },
      { id: 878, name: 'Sci-Fi' },
    ],
    poster_path: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
    backdrop_path: '/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg',
    overview:
      'Der Hacker Neo erfährt von mysteriösen Rebellen die schockierende Wahrheit über seine Realität und seine Rolle im Krieg gegen die Maschinen.',
    fsk: 'FSK 16',
    trailerKey: 'vKQi3bBA1y8',
    belongs_to_collection: { id: 2344, name: 'Matrix Filmreihe' },
    production_companies: [{ id: 174, name: 'Warner Bros. Pictures' }],
    production_countries: [{ iso_3166_1: 'US', name: 'USA' }],
    credits: {
      cast: [
        { id: 6384, name: 'Keanu Reeves', character: 'Neo', profile_path: '/4D0PpNI0kmP58hgrwGC3wCjxhnm.jpg' },
        { id: 2975, name: 'Laurence Fishburne', character: 'Morpheus', profile_path: '/8suOhUmPbfKqDQ17jQ1Gy0mI3P4.jpg' },
        { id: 530, name: 'Carrie-Anne Moss', character: 'Trinity', profile_path: '/xD4jTA3KmVp5Rq3aHcymL9DUGjD.jpg' },
        { id: 1331, name: 'Hugo Weaving', character: 'Agent Smith', profile_path: '/t4ScpYIHlXVD41scEyiGdQDYflX.jpg' },
      ],
      crew: [{ id: 9340, name: 'Lana Wachowski', job: 'Director' }],
    },
    providersFlatrate: ['Netflix'],
    providerIds: [8],
  },
  {
    id: 120,
    media_type: 'movie',
    title: 'Der Herr der Ringe: Die Gefährten',
    original_title: 'The Lord of the Rings: The Fellowship of the Ring',
    release_date: '2001-12-18',
    vote_average: 8.9,
    vote_count: 24900,
    popularity: 920.1,
    runtime: 178,
    genre_ids: [12, 14, 28],
    genres: [
      { id: 12, name: 'Abenteuer' },
      { id: 14, name: 'Fantasy' },
      { id: 28, name: 'Action' },
    ],
    poster_path: '/6oom5QYQ2yQTMJIbnvbkBL9cHo6.jpg',
    backdrop_path: '/x2RS3uTcsJJ9IfjNPcgDmukoEcQ.jpg',
    overview:
      'Ein junger Hobbit namens Frodo Beutlin bricht mit acht Gefährten zu einer gefährlichen Reise auf, um den Einen Ring im Schicksalsberg zu vernichten.',
    fsk: 'FSK 12',
    trailerKey: 'V75dMMIW2B4',
    belongs_to_collection: { id: 119, name: 'Der Herr der Ringe Filmreihe' },
    production_companies: [{ id: 12, name: 'New Line Cinema' }],
    production_countries: [{ iso_3166_1: 'NZ', name: 'Neuseeland' }],
    credits: {
      cast: [
        { id: 109, name: 'Elijah Wood', character: 'Frodo Baggins', profile_path: '/7UKRbJBNG7mxBl2QQc5XsAh6F8B.jpg' },
        { id: 1327, name: 'Ian McKellen', character: 'Gandalf', profile_path: '/5cnnnpnJG6TiYUSS7qgJheUZgnv.jpg' },
        { id: 110, name: 'Viggo Mortensen', character: 'Aragorn', profile_path: '/vH5gVSpHAMhDaFWfh0Q7BG61O1y.jpg' },
        { id: 114, name: 'Orlando Bloom', character: 'Legolas', profile_path: '/lwQoA0qJTCZ6l2FH6PjmhRQjiaB.jpg' },
        { id: 48, name: 'Sean Bean', character: 'Boromir', profile_path: '/kTjiABk3TJ3yI0Cto5RsvyT6V3o.jpg' },
      ],
      crew: [{ id: 108, name: 'Peter Jackson', job: 'Director' }],
    },
    providersFlatrate: ['Amazon Prime Video', 'WOW'],
    providerIds: [9, 30],
  },
  {
    id: 693134,
    media_type: 'movie',
    title: 'Dune: Part Two',
    original_title: 'Dune: Part Two',
    release_date: '2024-02-27',
    vote_average: 8.4,
    vote_count: 6400,
    popularity: 950.4,
    runtime: 166,
    genre_ids: [878, 12],
    genres: [
      { id: 878, name: 'Sci-Fi' },
      { id: 12, name: 'Abenteuer' },
    ],
    poster_path: '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    backdrop_path: '/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg',
    overview:
      'Paul Atreides verbündet sich mit Chani und den Fremen auf dem Wüstenplaneten Arrakis, während er auf einem Rachefeldzug gegen die Verschwörer ist, die seine Familie zerstört haben.',
    fsk: 'FSK 12',
    trailerKey: 'Way9Dexny3w',
    belongs_to_collection: { id: 726871, name: 'Dune Filmreihe' },
    production_companies: [{ id: 174, name: 'Warner Bros. Pictures' }],
    production_countries: [{ iso_3166_1: 'US', name: 'USA' }],
    credits: {
      cast: [
        { id: 1190668, name: 'Timothée Chalamet', character: 'Paul Atreides', profile_path: '/BE2sdjpgsa2rNTFa66f7upkaOP.jpg' },
        { id: 505710, name: 'Zendaya', character: 'Chani', profile_path: '/3WdOloHpjtjL96uVOhFRRCcYSwq.jpg' },
        { id: 933238, name: 'Rebecca Ferguson', character: 'Lady Jessica', profile_path: '/lJloTOheuQSirSLXNA3JHsrMNfH.jpg' },
        { id: 3810, name: 'Javier Bardem', character: 'Stilgar', profile_path: '/IShnFg6ijWhpbu29dFBd9PtqQg.jpg' },
        { id: 86654, name: 'Austin Butler', character: 'Feyd-Rautha', profile_path: '/rZyjfbN2P7t8b2zV43K7F9w2A7B.jpg' },
      ],
      crew: [{ id: 137427, name: 'Denis Villeneuve', job: 'Director' }],
    },
    providersFlatrate: ['WOW', 'Amazon Prime Video'],
    providerIds: [30, 9],
  },
  {
    id: 155,
    media_type: 'movie',
    title: 'The Dark Knight',
    original_title: 'The Dark Knight',
    release_date: '2008-07-16',
    vote_average: 8.5,
    vote_count: 32900,
    popularity: 870.0,
    runtime: 152,
    genre_ids: [18, 28, 80, 53],
    genres: [
      { id: 28, name: 'Action' },
      { id: 80, name: 'Krimi' },
      { id: 18, name: 'Drama' },
    ],
    poster_path: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
    backdrop_path: '/nMKdUUepR0i5zn0y1T4CsSB5chy.jpg',
    overview:
      'Batman, Lieutenant Gordon und Staatsanwalt Harvey Dent treten gemeinsam gegen das kriminelle Genie namens Joker an, das Gotham City ins Chaos stürzt.',
    fsk: 'FSK 16',
    trailerKey: 'EXeTwQWrcwY',
    belongs_to_collection: { id: 263, name: 'The Dark Knight Trilogie' },
    production_companies: [{ id: 174, name: 'Warner Bros. Pictures' }, { id: 9993, name: 'DC Entertainment' }],
    production_countries: [{ iso_3166_1: 'US', name: 'USA' }],
    credits: {
      cast: [
        { id: 3894, name: 'Christian Bale', character: 'Bruce Wayne / Batman', profile_path: '/b7fTC9WFkgqGOv77mLQtmD4Bwjx.jpg' },
        { id: 1810, name: 'Heath Ledger', character: 'Joker', profile_path: '/5Y9HnYYa9jF4NunY9lSgJGjSe8E.jpg' },
        { id: 64, name: 'Gary Oldman', character: 'James Gordon', profile_path: '/2v9FVVBUrrkW2m3QOcYkuhq9A6o.jpg' },
        { id: 3895, name: 'Michael Caine', character: 'Alfred', profile_path: '/bVZRMlpjTAO2pJK6v90buFgVbSW.jpg' },
        { id: 192, name: 'Morgan Freeman', character: 'Lucius Fox', profile_path: '/jPsLqiYGSofU4s6BjrxnefMfabb.jpg' },
      ],
      crew: [{ id: 525, name: 'Christopher Nolan', job: 'Director' }],
    },
    providersFlatrate: ['Netflix', 'Amazon Prime Video'],
    providerIds: [8, 9],
  },
  {
    id: 872585,
    media_type: 'movie',
    title: 'Oppenheimer',
    original_title: 'Oppenheimer',
    release_date: '2023-07-19',
    vote_average: 8.1,
    vote_count: 9200,
    popularity: 840.3,
    runtime: 181,
    genre_ids: [18, 36],
    genres: [
      { id: 18, name: 'Drama' },
      { id: 36, name: 'Historie' },
    ],
    poster_path: '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    backdrop_path: '/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg',
    overview:
      'Die Geschichte des theoretischen Physikers J. Robert Oppenheimer und seiner Rolle als wissenschaftlicher Leiter des Manhattan-Projekts.',
    fsk: 'FSK 12',
    trailerKey: 'uYPbbksJxIg',
    production_companies: [{ id: 33, name: 'Universal Pictures' }],
    production_countries: [{ iso_3166_1: 'US', name: 'USA' }],
    credits: {
      cast: [
        { id: 2037, name: 'Cillian Murphy', character: 'J. Robert Oppenheimer', profile_path: '/dm6V24NjjvjMiCtbMkc8Y2WPm2e.jpg' },
        { id: 3223, name: 'Robert Downey Jr.', character: 'Lewis Strauss', profile_path: '/5qHNjhtjMD4YWH3UP0rm4tKwxCL.jpg' },
        { id: 5081, name: 'Emily Blunt', character: 'Kitty Oppenheimer', profile_path: '/5nCSG5TL1bP1geD8aaBfaLnLLCD.jpg' },
        { id: 1892, name: 'Matt Damon', character: 'Leslie Groves', profile_path: '/At3JgvaNeEN4Z4ESKlhhes85Xo3.jpg' },
      ],
      crew: [{ id: 525, name: 'Christopher Nolan', job: 'Director' }],
    },
    providersFlatrate: ['WOW'],
    providerIds: [30],
  },
  {
    id: 299534,
    media_type: 'movie',
    title: 'Avengers: Endgame',
    original_title: 'Avengers: Endgame',
    release_date: '2019-04-24',
    vote_average: 8.3,
    vote_count: 25600,
    popularity: 825.0,
    runtime: 181,
    genre_ids: [12, 878, 28],
    genres: [
      { id: 12, name: 'Abenteuer' },
      { id: 878, name: 'Sci-Fi' },
      { id: 28, name: 'Action' },
    ],
    poster_path: '/or06FN3Dka5tukK1e9sl16pB3iy.jpg',
    backdrop_path: '/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg',
    overview:
      'Nach den verheerenden Ereignissen von Infinity War versammeln sich die verbliebenen Avengers ein letztes Mal, um Thanos Taten rückgängig zu machen.',
    fsk: 'FSK 12',
    trailerKey: 'TcMBFSGVi1c',
    belongs_to_collection: { id: 86311, name: 'The Avengers (Marvel)' },
    production_companies: [{ id: 420, name: 'Marvel Studios' }],
    production_countries: [{ iso_3166_1: 'US', name: 'USA' }],
    credits: {
      cast: [
        { id: 3223, name: 'Robert Downey Jr.', character: 'Tony Stark / Iron Man', profile_path: '/5qHNjhtjMD4YWH3UP0rm4tKwxCL.jpg' },
        { id: 16828, name: 'Chris Evans', character: 'Steve Rogers / Captain America', profile_path: '/3bOGNsHlrswhyW79uvIHH1V43JI.jpg' },
        { id: 1245, name: 'Scarlett Johansson', character: 'Natasha Romanoff', profile_path: '/6NsMbJXRlDZuDzatN2akFdGuTvx.jpg' },
        { id: 74568, name: 'Chris Hemsworth', character: 'Thor', profile_path: '/xkHHiJXraaMFXgRYspN6KVrFn17.jpg' },
      ],
      crew: [{ id: 19272, name: 'Anthony Russo', job: 'Director' }],
    },
    providersFlatrate: ['Disney+'],
    providerIds: [337],
  },
  {
    id: 533535,
    media_type: 'movie',
    title: 'Deadpool & Wolverine',
    original_title: 'Deadpool & Wolverine',
    release_date: '2024-07-24',
    vote_average: 7.8,
    vote_count: 5800,
    popularity: 910.7,
    runtime: 128,
    genre_ids: [28, 35, 878],
    genres: [
      { id: 28, name: 'Action' },
      { id: 35, name: 'Komödie' },
      { id: 878, name: 'Sci-Fi' },
    ],
    poster_path: '/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
    backdrop_path: '/yDHYTfA3R0jFYba16jBB1ef8oIt.jpg',
    overview:
      'Die Time Variance Authority reißt Wade Wilson aus seinem ruhigen Leben und schickt ihn gemeinsam mit einem widerwilligen Wolverine auf eine Mission durch das Multiversum.',
    fsk: 'FSK 16',
    trailerKey: '73_1biulkYk',
    production_companies: [{ id: 420, name: 'Marvel Studios' }],
    production_countries: [{ iso_3166_1: 'US', name: 'USA' }],
    credits: {
      cast: [
        { id: 10859, name: 'Ryan Reynolds', character: 'Wade Wilson / Deadpool', profile_path: '/4SYTH5FdB0dAORV98Nwg3llgVnY.jpg' },
        { id: 6968, name: 'Hugh Jackman', character: 'Logan / Wolverine', profile_path: '/oX6CpXmnXCHLyqsa4NEed1DZAKx.jpg' },
      ],
      crew: [{ id: 17825, name: 'Shawn Levy', job: 'Director' }],
    },
    providersFlatrate: ['Disney+'],
    providerIds: [337],
  },
];

const SIMULATED_TMDB_SERIES = [
  {
    id: 1396,
    media_type: 'tv',
    name: 'Breaking Bad',
    original_name: 'Breaking Bad',
    first_air_date: '2008-01-20',
    vote_average: 8.9,
    vote_count: 14200,
    popularity: 960.0,
    episode_run_time: [47],
    number_of_seasons: 5,
    number_of_episodes: 62,
    genre_ids: [18, 80],
    genres: [
      { id: 18, name: 'Drama' },
      { id: 80, name: 'Krimi' },
    ],
    poster_path: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
    backdrop_path: '/gc8PfyTqzqltKPW3X0cIVUGmagz.jpg',
    overview:
      'Ein an Lungenkrebs erkrankter Chemielehrer beginnt zusammen mit einem ehemaligen Schüler Crystal Meth herzustellen, um die finanzielle Zukunft seiner Familie zu sichern.',
    fsk: 'FSK 16',
    trailerKey: 'HhesaQXLuRY',
    production_companies: [{ id: 11073, name: 'Sony Pictures Television' }],
    origin_country: ['US'],
    credits: {
      cast: [
        { id: 17419, name: 'Bryan Cranston', character: 'Walter White', profile_path: '/7Jahy5LZX2Fo8fGJltMreAI49hC.jpg' },
        { id: 84497, name: 'Aaron Paul', character: 'Jesse Pinkman', profile_path: '/8Ac9uuoYwZoYVAIJfRLzzLsGGJn.jpg' },
        { id: 59315, name: 'Bob Odenkirk', character: 'Saul Goodman', profile_path: '/rF0Lb6SBhGSTvjRffmlKRSeI3jE.jpg' },
      ],
      crew: [{ id: 66633, name: 'Vince Gilligan', job: 'Creator' }],
    },
    providersFlatrate: ['Netflix'],
    providerIds: [8],
  },
  {
    id: 70523,
    media_type: 'tv',
    name: 'Dark',
    original_name: 'Dark',
    first_air_date: '2017-12-01',
    vote_average: 8.4,
    vote_count: 6800,
    popularity: 850.5,
    episode_run_time: [55],
    number_of_seasons: 3,
    number_of_episodes: 26,
    genre_ids: [18, 9648, 10765],
    genres: [
      { id: 18, name: 'Drama' },
      { id: 9648, name: 'Mystery' },
      { id: 10765, name: 'Sci-Fi & Fantasy' },
    ],
    poster_path: '/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg',
    backdrop_path: '/3lBDg3i6nn5R2NKFCJ6oKyUo2j5.jpg',
    overview:
      'Als zwei Kinder in einer deutschen Kleinstadt verschwinden, tritt die düstere Vergangenheit der vier ansässigen Familien und ein Zeitreise-Mysterium über drei Generationen zutage.',
    fsk: 'FSK 16',
    trailerKey: 'rrwycJ08PSA',
    production_companies: [{ id: 8, name: 'Netflix' }],
    origin_country: ['DE'],
    credits: {
      cast: [
        { id: 1429346, name: 'Louis Hofmann', character: 'Jonas Kahnwald', profile_path: '/aB2K8v1K2B7H6X8c9y0G5o4K5x1.jpg' },
        { id: 1468482, name: 'Lisa Vicari', character: 'Martha Nielsen', profile_path: '/4D0PpNI0kmP58hgrwGC3wCjxhnm.jpg' },
      ],
      crew: [{ id: 56241, name: 'Baran bo Odar', job: 'Director' }],
    },
    providersFlatrate: ['Netflix'],
    providerIds: [8],
  },
  {
    id: 66732,
    media_type: 'tv',
    name: 'Stranger Things',
    original_name: 'Stranger Things',
    first_air_date: '2016-07-15',
    vote_average: 8.6,
    vote_count: 17500,
    popularity: 920.2,
    episode_run_time: [50],
    number_of_seasons: 4,
    number_of_episodes: 34,
    genre_ids: [18, 10765, 9648],
    genres: [
      { id: 18, name: 'Drama' },
      { id: 10765, name: 'Sci-Fi & Fantasy' },
      { id: 9648, name: 'Mystery' },
    ],
    poster_path: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg',
    backdrop_path: '/56v2KjBlU4XaOv9rVYEQypROD7P.jpg',
    overview:
      'Nach dem mysteriösen Verschwinden eines Jungen in der Kleinstadt Hawkins stoßen seine Freunde auf geheime Regierungsexperimente, übernatürliche Kräfte und ein seltsames Mädchen namens Elf.',
    fsk: 'FSK 16',
    trailerKey: 'b9EkMc79ZSU',
    production_companies: [{ id: 8, name: 'Netflix' }],
    origin_country: ['US'],
    credits: {
      cast: [
        { id: 1356210, name: 'Millie Bobby Brown', character: 'Eleven', profile_path: '/3bOGNsHlrswhyW79uvIHH1V43JI.jpg' },
        { id: 1440619, name: 'Finn Wolfhard', character: 'Mike Wheeler', profile_path: '/BE2sdjpgsa2rNTFa66f7upkaOP.jpg' },
        { id: 1920, name: 'Winona Ryder', character: 'Joyce Byers', profile_path: '/5nCSG5TL1bP1geD8aaBfaLnLLCD.jpg' },
        { id: 35029, name: 'David Harbour', character: 'Jim Hopper', profile_path: '/chPekukMF5SNnW6b22NbYPqAStr.jpg' },
      ],
      crew: [{ id: 1179419, name: 'Matt Duffer', job: 'Creator' }],
    },
    providersFlatrate: ['Netflix'],
    providerIds: [8],
  },
  {
    id: 126308,
    media_type: 'tv',
    name: 'Shōgun',
    original_name: 'Shōgun',
    first_air_date: '2024-02-27',
    vote_average: 8.6,
    vote_count: 1950,
    popularity: 880.4,
    episode_run_time: [60],
    number_of_seasons: 1,
    number_of_episodes: 10,
    genre_ids: [18, 10768, 10759],
    genres: [
      { id: 18, name: 'Drama' },
      { id: 10768, name: 'War & Politics' },
      { id: 10759, name: 'Action & Adventure' },
    ],
    poster_path: '/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg',
    backdrop_path: '/5zmiBoMzeeVdQ62no55JOJMY498.jpg',
    overview:
      'Im Japan des Jahres 1600 kämpft Fürst Yoshii Toranaga um sein Leben, als sich seine Feinde im Rat der Regenten gegen ihn verbünden und ein gestrandeter englischer Navigator Geheimnisse mitbringt.',
    fsk: 'FSK 16',
    trailerKey: 'yAN5uspO_hk',
    production_companies: [{ id: 25, name: 'FX Productions' }],
    origin_country: ['US', 'JP'],
    credits: {
      cast: [
        { id: 9195, name: 'Hiroyuki Sanada', character: 'Lord Yoshii Toranaga', profile_path: '/SOw3K8z7hX8s8zF6s8Q8z8Q8z8Q.jpg' },
        { id: 76961, name: 'Cosmo Jarvis', character: 'John Blackthorne', profile_path: '/At3JgvaNeEN4Z4ESKlhhes85Xo3.jpg' },
        { id: 1966006, name: 'Anna Sawai', character: 'Toda Mariko', profile_path: '/tLelKoPNiyJCSEtQTz1FGv4TLGc.jpg' },
      ],
      crew: [{ id: 1223196, name: 'Rachel Kondo', job: 'Creator' }],
    },
    providersFlatrate: ['Disney+'],
    providerIds: [337],
  },
  {
    id: 95396,
    media_type: 'tv',
    name: 'Severance',
    original_name: 'Severance',
    first_air_date: '2022-02-17',
    vote_average: 8.4,
    vote_count: 2100,
    popularity: 840.1,
    episode_run_time: [50],
    number_of_seasons: 2,
    number_of_episodes: 19,
    genre_ids: [18, 9648, 10765],
    genres: [
      { id: 18, name: 'Drama' },
      { id: 9648, name: 'Mystery' },
      { id: 10765, name: 'Sci-Fi & Fantasy' },
    ],
    poster_path: '/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg',
    backdrop_path: '/ixgFmf1X59PUZam2qbAfskx2gQr.jpg',
    overview:
      'Mark leitet ein Büro-Team bei Lumon Industries, dessen Erinnerungen durch einen chirurgischen Eingriff strikt zwischen Arbeits- und Privatleben getrennt wurden.',
    fsk: 'FSK 12',
    trailerKey: 'xEQP4VVuyrY',
    production_companies: [{ id: 350, name: 'Apple Studios' }],
    origin_country: ['US'],
    credits: {
      cast: [
        { id: 36801, name: 'Adam Scott', character: 'Mark Scout', profile_path: '/b82C29R6fP0f9xV7R6N5q8z9w8E.jpg' },
        { id: 1498158, name: 'Britt Lower', character: 'Helly R.', profile_path: '/bXFXD9bf9S6kC3Y6R3x1yL22r5l.jpg' },
        { id: 1241, name: 'John Turturro', character: 'Irving Bailiff', profile_path: '/6dd81p5C2k8U5s3Z2y3Q2p6Y9W.jpg' },
        { id: 4690, name: 'Christopher Walken', character: 'Burt Goodman', profile_path: '/ApgE3N2P7t8b2zV43K7F9w2A7B.jpg' },
      ],
      crew: [{ id: 7399, name: 'Ben Stiller', job: 'Director' }],
    },
    providersFlatrate: ['Apple TV+'],
    providerIds: [350],
  },
  {
    id: 66676,
    media_type: 'tv',
    name: 'Frontier',
    original_name: 'Frontier',
    first_air_date: '2016-11-06',
    vote_average: 7.5,
    vote_count: 680,
    popularity: 790.0,
    episode_run_time: [45],
    number_of_seasons: 3,
    number_of_episodes: 18,
    genre_ids: [10759, 18],
    genres: [
      { id: 10759, name: 'Action & Adventure' },
      { id: 18, name: 'Drama' },
    ],
    poster_path: '/4kR9N2X9M2m4e2X1y0G5o4K5x1B.jpg',
    backdrop_path: '/xJHokMbljvjADYdit5fK5VQsXEG.jpg',
    overview:
      'Der gesetzlose Trapper Declan Harp kämpft im Nordamerika des 18. Jahrhunderts gegen das skrupellose Pelzhandelsmonopol der Hudson’s Bay Company.',
    fsk: 'FSK 16',
    trailerKey: 'zSWdZVtXT7E',
    production_companies: [{ id: 8, name: 'Netflix' }],
    origin_country: ['CA'],
    credits: {
      cast: [
        { id: 117642, name: 'Jason Momoa', character: 'Declan Harp', profile_path: '/6dEFBpZH8C8OijsynkSajQT99Pb.jpg' },
        { id: 10990, name: 'Landon Liboiron', character: 'Michael Smyth', profile_path: '/BE2sdjpgsa2rNTFa66f7upkaOP.jpg' },
        { id: 25147, name: 'Alun Armstrong', character: 'Lord Benton', profile_path: '/bVZRMlpjTAO2pJK6v90buFgVbSW.jpg' },
      ],
      crew: [{ id: 1215399, name: 'Brad Peyton', job: 'Director' }],
    },
    providersFlatrate: ['Netflix'],
    providerIds: [8],
  },
];

function buildSimulatedTmdbDetailsPayload(item: any, isSeries: boolean): any {
  const numSeasons = Number(item.number_of_seasons || 3);
  const seasons = isSeries
    ? Array.from({ length: numSeasons }, (_, idx) => ({
        id: item.id * 10 + idx + 1,
        season_number: idx + 1,
        name: `Staffel ${idx + 1}`,
        episode_count: item.id === 66676 ? 6 : 8,
        air_date: item.first_air_date || '2022-01-01',
        poster_path: item.poster_path,
      }))
    : undefined;

  return {
    ...item,
    seasons,
    release_dates: !isSeries
      ? {
          results: [
            {
              iso_3166_1: 'DE',
              release_dates: [{ certification: (item.fsk || 'FSK 12').replace('FSK ', '') }],
            },
          ],
        }
      : undefined,
    content_ratings: isSeries
      ? {
          results: [{ iso_3166_1: 'DE', rating: (item.fsk || 'FSK 16').replace('FSK ', '') }],
        }
      : undefined,
    videos: {
      results: item.trailerKey
        ? [
            {
              key: item.trailerKey,
              site: 'YouTube',
              type: 'Trailer',
              official: true,
              name: 'Offizieller Trailer (Deutsch)',
            },
          ]
        : [],
    },
    'watch/providers': {
      results: {
        DE: {
          flatrate: (item.providersFlatrate || ['Netflix']).map((name: string, idx: number) => ({
            provider_id: item.providerIds?.[idx] || 8,
            provider_name: name,
          })),
        },
      },
    },
  };
}

function createSandboxFetch(envVars: Record<string, string>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // 1. Intercept Telegram Bot API calls so Live Telegram Simulator receives messages
    if (rawUrl.includes('api.telegram.org/bot')) {
      const match = rawUrl.match(/\/bot([^/]+)\/([A-Za-z0-9_]+)/);
      const tokenInUrl = match?.[1] || '';
      const method = match?.[2] || 'sendMessage';
      let payload: any = {};
      if (init?.body && typeof init.body === 'string') {
        try {
          payload = JSON.parse(init.body);
        } catch {
          payload = {};
        }
      }
      const simResult = recordSimulatedTelegramCall(method, payload);

      // If user configured a real external bot token, also forward if not simulated placeholder
      const isRealToken =
        tokenInUrl.includes(':') &&
        tokenInUrl.length > 30 &&
        !tokenInUrl.startsWith('123456:');
      if (isRealToken) {
        try {
          const liveRes = await window.fetch(input, init);
          if (liveRes.ok) return liveRes;
        } catch {
          // fall back to simulated response
        }
      }

      return new Response(JSON.stringify(simResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Intercept TMDb API calls when no live TMDB_BEARER_TOKEN is configured (or if live returns 401)
    if (rawUrl.includes('api.themoviedb.org/3/')) {
      const token = (envVars.TMDB_BEARER_TOKEN || '').trim();
      const hasRealTmdbToken = token.length > 40 && !token.startsWith('sim_');
      if (hasRealTmdbToken) {
        try {
          const liveRes = await window.fetch(input, init);
          if (liveRes.ok) return liveRes;
        } catch {
          // fall back to curated sandbox catalog
        }
      }

      const parsedUrl = new URL(rawUrl);
      const path = parsedUrl.pathname;

      // Movie or TV Discover / Trending
      if (path.includes('/discover/movie') || path.includes('/trending/movie')) {
        const withGenres = parsedUrl.searchParams.get('with_genres');
        let list = [...SIMULATED_TMDB_MOVIES];
        if (withGenres) {
          const gIds = withGenres.split(/[|,]/).map(Number).filter(Boolean);
          if (gIds.length > 0) {
            const filtered = list.filter((m) => m.genre_ids.some((id) => gIds.includes(id)));
            if (filtered.length > 0) list = filtered;
          }
        }
        return new Response(
          JSON.stringify({
            page: 1,
            results: list,
            total_pages: 1,
            total_results: list.length,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (path.includes('/discover/tv') || path.includes('/trending/tv')) {
        const withGenres = parsedUrl.searchParams.get('with_genres');
        let list = [...SIMULATED_TMDB_SERIES];
        if (withGenres) {
          const gIds = withGenres.split(/[|,]/).map(Number).filter(Boolean);
          if (gIds.length > 0) {
            const filtered = list.filter((s) => s.genre_ids.some((id) => gIds.includes(id)));
            if (filtered.length > 0) list = filtered;
          }
        }
        return new Response(
          JSON.stringify({
            page: 1,
            results: list,
            total_pages: 1,
            total_results: list.length,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Multi / Movie / TV Search
      if (path.includes('/search/')) {
        const q = (parsedUrl.searchParams.get('query') || '').toLowerCase().trim();
        const combined = [...SIMULATED_TMDB_MOVIES, ...SIMULATED_TMDB_SERIES];
        const matched = q
          ? combined.filter(
              (item: any) =>
                String(item.title || item.name || '')
                  .toLowerCase()
                  .includes(q) ||
                String(item.overview || '')
                  .toLowerCase()
                  .includes(q)
            )
          : combined;
        const results = matched.length > 0 ? matched : combined.slice(0, 6);
        return new Response(
          JSON.stringify({
            page: 1,
            results,
            total_pages: 1,
            total_results: results.length,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Collection Details (/3/collection/:id)
      const colMatch = path.match(/\/3\/collection\/(\d+)/);
      if (colMatch) {
        const colId = Number(colMatch[1]);
        const parts = SIMULATED_TMDB_MOVIES.filter(
          (m: any) => m.belongs_to_collection?.id === colId
        );
        const effParts = parts.length > 0 ? parts : SIMULATED_TMDB_MOVIES.slice(0, 4);
        return new Response(
          JSON.stringify({
            id: colId,
            name: effParts[0]?.belongs_to_collection?.name || ' Blockbuster Filmreihe',
            overview: 'Kuratiertes Filmuniversum mit allen Teilen in chronologischer Reihenfolge.',
            poster_path: effParts[0]?.poster_path,
            backdrop_path: effParts[0]?.backdrop_path,
            parts: effParts,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // TV Season Details (/3/tv/:id/season/:s)
      const seasonMatch = path.match(/\/3\/tv\/(\d+)\/season\/(\d+)/);
      if (seasonMatch) {
        const tvId = Number(seasonMatch[1]);
        const sNum = Number(seasonMatch[2]);
        const series =
          SIMULATED_TMDB_SERIES.find((s) => s.id === tvId) || SIMULATED_TMDB_SERIES[0];
        const epCount = tvId === 66676 ? 6 : 8;
        return new Response(
          JSON.stringify({
            _id: `${tvId}_s${sNum}`,
            id: tvId * 100 + sNum,
            name: `Staffel ${sNum}`,
            season_number: sNum,
            air_date: series.first_air_date,
            episodes: Array.from({ length: epCount }, (_, idx) => ({
              id: tvId * 1000 + sNum * 100 + idx + 1,
              episode_number: idx + 1,
              season_number: sNum,
              name: `Kapitel ${idx + 1}: ${series.name}`,
              overview: `Spannende Ereignisse in Staffel ${sNum}, Folge ${idx + 1} von ${series.name}.`,
              air_date: series.first_air_date,
              runtime: 48,
              still_path: series.backdrop_path,
              vote_average: series.vote_average,
            })),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Movie Recommendations / Similar
      const recMovieMatch = path.match(/\/3\/movie\/(\d+)\/(?:recommendations|similar)/);
      if (recMovieMatch) {
        const mId = Number(recMovieMatch[1]);
        const others = SIMULATED_TMDB_MOVIES.filter((m) => m.id !== mId);
        return new Response(JSON.stringify({ page: 1, results: others }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // TV Recommendations / Similar
      const recTvMatch = path.match(/\/3\/tv\/(\d+)\/(?:recommendations|similar)/);
      if (recTvMatch) {
        const tId = Number(recTvMatch[1]);
        const others = SIMULATED_TMDB_SERIES.filter((s) => s.id !== tId);
        return new Response(JSON.stringify({ page: 1, results: others }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Single Movie Details (/3/movie/:id)
      const movieMatch = path.match(/\/3\/movie\/(\d+)/);
      if (movieMatch) {
        const mId = Number(movieMatch[1]);
        const item =
          SIMULATED_TMDB_MOVIES.find((m) => m.id === mId) || SIMULATED_TMDB_MOVIES[0];
        return new Response(
          JSON.stringify(buildSimulatedTmdbDetailsPayload(item, false)),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Single TV Details (/3/tv/:id)
      const tvMatch = path.match(/\/3\/tv\/(\d+)/);
      if (tvMatch) {
        const tId = Number(tvMatch[1]);
        const item =
          SIMULATED_TMDB_SERIES.find((s) => s.id === tId) || SIMULATED_TMDB_SERIES[0];
        return new Response(
          JSON.stringify(buildSimulatedTmdbDetailsPayload(item, true)),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    return window.fetch(input, init);
  };
}

const SANDBOX_KV_STORAGE_KEY = '__tma_sandbox_kv_store_v1__';

export class SimulatedKVNamespace {
  private store: Map<string, KVItem> = new Map();
  private onChange?: () => void;

  constructor(initialStore?: Record<string, string>, onChange?: () => void) {
    this.onChange = onChange;
    if (initialStore) {
      for (const [k, v] of Object.entries(initialStore)) {
        this.store.set(k, {
          key: k,
          value: v,
          createdAt: Date.now(),
        });
      }
    }
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(SANDBOX_KV_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item.key === 'string' && typeof item.value === 'string') {
                this.store.set(item.key, {
                  key: item.key,
                  value: item.value,
                  expirationTtl: item.expirationTtl,
                  createdAt: Number(item.createdAt || Date.now()),
                });
              }
            }
          }
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private persistToStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          SANDBOX_KV_STORAGE_KEY,
          JSON.stringify(Array.from(this.store.values()))
        );
      }
    } catch {
      // Ignore quota errors
    }
    this.onChange?.();
  }

  async get(key: string, type: 'text' | 'json' | 'arrayBuffer' = 'text'): Promise<any> {
    const item = this.store.get(key);
    if (!item) return null;

    if (item.expirationTtl) {
      const ageSec = (Date.now() - item.createdAt) / 1000;
      if (ageSec > item.expirationTtl) {
        this.store.delete(key);
        this.persistToStorage();
        return null;
      }
    }

    if (type === 'json') {
      try {
        return JSON.parse(item.value);
      } catch {
        return null;
      }
    }
    if (type === 'arrayBuffer') {
      return new TextEncoder().encode(item.value).buffer;
    }
    return item.value;
  }

  async put(
    key: string,
    value: any,
    options?: { expirationTtl?: number; metadata?: any }
  ): Promise<void> {
    const stringVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
    this.store.set(key, {
      key,
      value: stringVal,
      expirationTtl: options?.expirationTtl,
      createdAt: Date.now(),
    });
    this.persistToStorage();
  }

  async delete(key: string): Promise<boolean> {
    const deleted = this.store.delete(key);
    if (deleted) this.persistToStorage();
    return deleted;
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: { name: string; expiration?: number }[];
    list_complete: boolean;
  }> {
    const prefix = options?.prefix || '';
    const limit = options?.limit || 100;
    const matchedKeys: { name: string; expiration?: number }[] = [];

    for (const [k, item] of this.store.entries()) {
      if (k.startsWith(prefix)) {
        matchedKeys.push({
          name: k,
          expiration: item.expirationTtl
            ? Math.floor((item.createdAt + item.expirationTtl * 1000) / 1000)
            : undefined,
        });
        if (matchedKeys.length >= limit) break;
      }
    }

    return {
      keys: matchedKeys,
      list_complete: true,
    };
  }

  getAllItems(): KVItem[] {
    return Array.from(this.store.values());
  }

  setItemDirect(key: string, value: string, expirationTtl?: number) {
    this.store.set(key, {
      key,
      value,
      expirationTtl,
      createdAt: Date.now(),
    });
    this.persistToStorage();
  }

  deleteItemDirect(key: string) {
    this.store.delete(key);
    this.persistToStorage();
  }

  clear() {
    this.store.clear();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(SANDBOX_KV_STORAGE_KEY);
      }
    } catch {}
    this.onChange?.();
  }
}

export function stripEsModuleExportsForSandbox(rawCode: string): string {
  let transformed = rawCode;
  // Strip named `export { ... };` blocks so `new Function()` does not fail with SyntaxError
  transformed = transformed.replace(/\bexport\s*\{[\s\S]*?\};?/g, '');
  if (/export\s+default\s+/.test(transformed)) {
    transformed = transformed.replace(/export\s+default\s+/, 'return ');
  } else if (!transformed.includes('return')) {
    transformed = `return ${transformed}`;
  }
  return transformed;
}

// Cache compiled worker instance so in-memory state (memoryFallback, tmdbCache, etc.) persists across requests
let cachedCodeKey = '';
let cachedFactory: any = null;
let cachedWorkerModule: any = null;
let activeSandboxConsole: any = console;
let activeSandboxFetch: any = fetch;

const delegatingConsole = {
  log: (...args: any[]) => activeSandboxConsole.log(...args),
  info: (...args: any[]) => activeSandboxConsole.info(...args),
  warn: (...args: any[]) => activeSandboxConsole.warn(...args),
  error: (...args: any[]) => activeSandboxConsole.error(...args),
};

const delegatingFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  activeSandboxFetch(input, init);

export async function executeWorkerSandbox(
  code: string,
  requestData: WorkerRequestData,
  envVars: Record<string, string>,
  kvNamespace: SimulatedKVNamespace
): Promise<{
  response: WorkerResponseData;
  logs: ConsoleLogEntry[];
}> {
  const startTime = performance.now();
  const logs: ConsoleLogEntry[] = [];

  const addLog = (level: 'log' | 'info' | 'warn' | 'error', args: any[]) => {
    logs.push({
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      level,
      args: args.map((arg) => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }),
      time: new Date().toLocaleTimeString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      }),
    });
  };

  const customConsole = {
    log: (...args: any[]) => addLog('log', args),
    info: (...args: any[]) => addLog('info', args),
    warn: (...args: any[]) => addLog('warn', args),
    error: (...args: any[]) => addLog('error', args),
  };

  let reqUrl = requestData.url.trim();
  if (!reqUrl.startsWith('http://') && !reqUrl.startsWith('https://')) {
    reqUrl = `https://edge-worker.workers.dev${reqUrl.startsWith('/') ? '' : '/'}${reqUrl}`;
  }

  const reqHeaders = new Headers();
  for (const [k, v] of Object.entries(requestData.headers || {})) {
    if (k && v) {
      try {
        reqHeaders.set(k, v);
      } catch {
        // Ignore invalid header format
      }
    }
  }

  const reqInit: RequestInit = {
    method: (requestData.method || 'GET').toUpperCase(),
    headers: reqHeaders,
  };

  if (!['GET', 'HEAD'].includes(reqInit.method!) && requestData.body) {
    reqInit.body = requestData.body;
  }

  let request: Request;
  try {
    request = new Request(reqUrl, reqInit);
  } catch (err: any) {
    return {
      response: {
        status: 400,
        statusText: 'Bad Request Init',
        headers: { 'content-type': 'text/plain' },
        body: `Worker Request Initialization Error: ${err.message}`,
        durationMs: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
        error: err.message,
      },
      logs,
    };
  }

  (request as any).cf = {
    ...(requestData.cf || {}),
    asn: requestData.cf?.asn || 13335,
    colo: requestData.cf?.colo || 'FRA',
    country: requestData.cf?.country || 'DE',
    city: requestData.cf?.city || 'Frankfurt',
    clientTrustScore: requestData.cf?.clientTrustScore ?? 99,
    tlsVersion: requestData.cf?.tlsVersion || 'TLSv1.3',
  };

  const backgroundPromises: Promise<any>[] = [];
  const ctx = {
    waitUntil(promise: Promise<any>) {
      backgroundPromises.push(promise);
    },
    passThroughOnException() {},
  };

  const env: Record<string, any> = {
    TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    TMDB_BEARER_TOKEN: 'sim_tmdb_token_v4_streamflix',
    ...envVars,
    MY_KV: kvNamespace,
    KV: kvNamespace,
    MOVIE_SAVED: kvNamespace,
  };

  const sandboxFetch = createSandboxFetch(env);
  activeSandboxConsole = customConsole;
  activeSandboxFetch = sandboxFetch;

  try {
    let responseObj: Response | null = null;

    if (code.includes('addEventListener') && code.includes('fetch') && !code.includes('export default')) {
      let fetchListener: ((event: any) => void) | null = null;
      const mockAddEventListener = (event: string, fn: (e: any) => void) => {
        if (event === 'fetch') {
          fetchListener = fn;
        }
      };

      const wrappedCode = `
        return function(addEventListener, console, env, ctx, Request, Response, Headers, fetch) {
          ${code}
        }
      `;

      const runner = new Function(wrappedCode)();
      runner(
        mockAddEventListener,
        customConsole,
        env,
        ctx,
        Request,
        Response,
        Headers,
        sandboxFetch
      );

      if (!fetchListener) {
        throw new Error('No "fetch" event listener registered via addEventListener("fetch", ...)');
      }

      await new Promise<void>((resolve, reject) => {
        const mockEvent = {
          request,
          respondWith(responsePromise: Promise<Response> | Response) {
            Promise.resolve(responsePromise)
              .then((res) => {
                responseObj = res;
                resolve();
              })
              .catch(reject);
          },
          waitUntil: ctx.waitUntil,
          passThroughOnException: ctx.passThroughOnException,
        };

        try {
          fetchListener!(mockEvent);
        } catch (e) {
          reject(e);
        }
      });
    } else {
      if (cachedCodeKey !== code || !cachedFactory || !cachedWorkerModule) {
        const transformedCode = stripEsModuleExportsForSandbox(code);
        const wrappedCode = `
          return function(console, Request, Response, Headers, fetch) {
            ${transformedCode}
          }
        `;
        cachedFactory = new Function(wrappedCode)();
        cachedWorkerModule = cachedFactory(
          delegatingConsole,
          Request,
          Response,
          Headers,
          delegatingFetch
        );
        cachedCodeKey = code;
      }

      const workerModule = cachedWorkerModule;

      if (!workerModule || typeof workerModule.fetch !== 'function') {
        throw new Error(
          'Worker module must export a default object with a "fetch(request, env, ctx)" function.'
        );
      }

      responseObj = await workerModule.fetch(request, env, ctx);
    }

    if (backgroundPromises.length > 0) {
      await Promise.allSettled(backgroundPromises);
    }

    if (!responseObj) {
      throw new Error('Worker did not return a valid Response instance.');
    }

    const responseHeaders: Record<string, string> = {};
    if (responseObj.headers && typeof responseObj.headers.forEach === 'function') {
      responseObj.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });
    }

    const durationMs = Math.round(performance.now() - startTime);
    const bodyText = await responseObj.text();

    return {
      response: {
        status: responseObj.status,
        statusText: responseObj.statusText || getHttpStatusText(responseObj.status),
        headers: responseHeaders,
        body: bodyText,
        durationMs,
        timestamp: new Date().toISOString(),
      },
      logs,
    };
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - startTime);
    customConsole.error('Worker Runtime Exception:', err.message, err.stack);
    return {
      response: {
        status: 500,
        statusText: 'Worker Execution Error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          {
            error: 'Cloudflare Worker Exception',
            message: err.message,
            stack: err.stack?.split('\n').slice(0, 5) || [],
          },
          null,
          2
        ),
        durationMs,
        timestamp: new Date().toISOString(),
        error: err.message,
      },
      logs,
    };
  }
}

function getHttpStatusText(status: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return map[status] || 'Response';
}

export interface D1ExistingTitleMatch {
  matched: boolean;
  confidence: number;
  tmdbId: number | null;
  typeCode: 'm' | 's';
  title: string;
  year: number | null;
  posterUrl: string;
  overview?: string;
  source: string;
}

interface D1CatalogRecord {
  tmdbId: number;
  typeCode: 'm' | 's';
  title: string;
  originalTitle?: string;
  normTitle: string;
  normOriginalTitle: string;
  year: number | null;
  posterUrl: string;
  overview?: string;
}

const D1_TITLE_CATALOG_STORAGE_KEY = '__tma_d1_title_catalog_v1__';
const runtimeD1TitleCatalog = new Map<string, D1CatalogRecord>();
let d1TitleCatalogSeeded = false;

export function normalizeMediaTitleForD1Lookup(rawInput: string): {
  cleanTitle: string;
  normTitle: string;
  year: number | null;
  isSeries: boolean;
} {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return { cleanTitle: '', normTitle: '', year: null, isSeries: false };
  }

  const isSeries =
    /\b(S\d{1,2}\s*E\d{1,3}|S\d{1,2}|\d{1,2}x\d{1,3}|Staffel\s*\d+|Folge\s*\d+|Episode\s*\d+|Season\s*\d+|Complete\s*Series)\b/i.test(
      raw
    );

  // Strip file extension
  let cleaned = raw.replace(/\.(mp4|mkv|avi|mov|m4v|webm|ts|flv|wmv)$/i, ' ');

  // Extract 4-digit release year if present (prefer year before technical tags)
  const yearMatch = cleaned.match(/(?:^|[\s([._-])((?:19|20)\d{2})(?=$|[\s)\]._,-])/);
  const extractedYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // Truncate everything starting at episode marker or release/quality tag
  cleaned = cleaned
    .replace(
      /\b(S\d{1,2}\s*E\d{1,3}|S\d{1,2}|\d{1,2}x\d{1,3}|Staffel\s*\d+|Folge\s*\d+|Episode\s*\d+|Season\s*\d+)\b.*$/i,
      ' '
    )
    .replace(
      /\b(2160p|1080p|720p|480p|4K|UHD|HDR|HDR10|DV|GERMAN|DEUTSCH|DL|DUAL|ML|WEBRip|WEB-DL|WEBDL|BluRay|BDRip|BRRip|HDTV|DVDRip|x264|x265|h264|h265|HEVC|AVC|AAC|AC3|EAC3|DTS|TrueHD|Atmos|EXTENDED|UNCUT|REMASTERED|DIRECTORS\s*CUT|PROPER|REPACK)\b.*$/i,
      ' '
    );

  // Remove year in parentheses or trailing year
  if (extractedYear) {
    cleaned = cleaned.replace(new RegExp(`\\(\\s*${extractedYear}\\s*\\)`, 'g'), ' ');
    cleaned = cleaned.replace(new RegExp(`\\[\\s*${extractedYear}\\s*\\]`, 'g'), ' ');
    cleaned = cleaned.replace(new RegExp(`\\b${extractedYear}\\b\\s*$`, 'g'), ' ');
  }

  cleaned = cleaned
    .replace(/[._]+/g, ' ')
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const normTitle = cleaned
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/ō/g, 'o')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    cleanTitle: cleaned || raw,
    normTitle,
    year: extractedYear,
    isSeries,
  };
}

function normalizeExactString(val: string): string {
  return String(val || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/ō/g, 'o')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureD1TitleCatalogSeeded(kvNamespace?: SimulatedKVNamespace | null) {
  if (!d1TitleCatalogSeeded) {
    d1TitleCatalogSeeded = true;
    for (const m of SIMULATED_TMDB_MOVIES) {
      const year = m.release_date ? parseInt(String(m.release_date).slice(0, 4), 10) || null : null;
      const posterUrl = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '';
      const key = `m_${m.id}`;
      runtimeD1TitleCatalog.set(key, {
        tmdbId: Number(m.id),
        typeCode: 'm',
        title: m.title,
        originalTitle: m.original_title || m.title,
        normTitle: normalizeExactString(m.title),
        normOriginalTitle: normalizeExactString(m.original_title || m.title),
        year,
        posterUrl,
        overview: m.overview || '',
      });
    }
    for (const s of SIMULATED_TMDB_SERIES) {
      const year = s.first_air_date ? parseInt(String(s.first_air_date).slice(0, 4), 10) || null : null;
      const posterUrl = s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : '';
      const key = `s_${s.id}`;
      runtimeD1TitleCatalog.set(key, {
        tmdbId: Number(s.id),
        typeCode: 's',
        title: s.name,
        originalTitle: s.original_name || s.name,
        normTitle: normalizeExactString(s.name),
        normOriginalTitle: normalizeExactString(s.original_name || s.name),
        year,
        posterUrl,
        overview: s.overview || '',
      });
    }

    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(D1_TITLE_CATALOG_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const rec of parsed) {
              if (rec && rec.tmdbId && rec.title) {
                const key = `${rec.typeCode === 's' ? 's' : 'm'}_${rec.tmdbId}`;
                runtimeD1TitleCatalog.set(key, {
                  tmdbId: Number(rec.tmdbId),
                  typeCode: rec.typeCode === 's' ? 's' : 'm',
                  title: String(rec.title),
                  originalTitle: String(rec.originalTitle || rec.title),
                  normTitle: normalizeExactString(rec.title),
                  normOriginalTitle: normalizeExactString(rec.originalTitle || rec.title),
                  year: rec.year ? Number(rec.year) : null,
                  posterUrl: String(rec.posterUrl || ''),
                  overview: String(rec.overview || ''),
                });
              }
            }
          }
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  // Also index any saved lists or D1 entities stored inside SimulatedKVNamespace
  if (kvNamespace && typeof kvNamespace.getAllItems === 'function') {
    for (const kvItem of kvNamespace.getAllItems()) {
      if (!kvItem || !kvItem.key || !kvItem.value) continue;
      if (
        kvItem.key.startsWith('saved_list_') ||
        kvItem.key.startsWith('d1_catalog_movie_') ||
        kvItem.key.startsWith('d1_catalog_series_')
      ) {
        try {
          const parsed = JSON.parse(kvItem.value);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          for (const entry of list) {
            const tmdbId = Number(entry?.tmdbId || entry?.id || 0);
            const title = String(entry?.title || entry?.name || entry?.cleanTitle || '').trim();
            if (!tmdbId || !title) continue;
            const typeCode: 'm' | 's' =
              entry?.contentType === 'series' ||
              entry?.typeCode === 's' ||
              kvItem.key.startsWith('d1_catalog_series_')
                ? 's'
                : 'm';
            const rawYear = entry?.year || entry?.releaseDate || entry?.release_date || entry?.first_air_date;
            const yearMatch = rawYear ? String(rawYear).match(/\b((?:19|20)\d{2})\b/) : null;
            const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
            const posterUrl = String(
              entry?.poster ||
                entry?.external_poster_url ||
                (entry?.poster_path ? `https://image.tmdb.org/t/p/w500${entry.poster_path}` : '')
            );
            const key = `${typeCode}_${tmdbId}`;
            if (!runtimeD1TitleCatalog.has(key)) {
              runtimeD1TitleCatalog.set(key, {
                tmdbId,
                typeCode,
                title,
                originalTitle: String(entry?.originalTitle || title),
                normTitle: normalizeExactString(title),
                normOriginalTitle: normalizeExactString(entry?.originalTitle || title),
                year,
                posterUrl,
              });
            }
          }
        } catch {
          // ignore malformed KV json
        }
      }
    }
  }
}

export function registerResolvedTitleInD1Catalog(entry: {
  tmdbId: number;
  typeCode: 'm' | 's';
  title: string;
  originalTitle?: string;
  year?: number | string | null;
  posterUrl?: string;
  overview?: string;
}) {
  const tmdbId = Number(entry?.tmdbId || 0);
  const title = String(entry?.title || '').trim();
  if (!tmdbId || !title) return;
  const typeCode: 'm' | 's' = entry.typeCode === 's' ? 's' : 'm';
  const yearMatch = entry.year ? String(entry.year).match(/\b((?:19|20)\d{2})\b/) : null;
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const key = `${typeCode}_${tmdbId}`;
  runtimeD1TitleCatalog.set(key, {
    tmdbId,
    typeCode,
    title,
    originalTitle: entry.originalTitle || title,
    normTitle: normalizeExactString(title),
    normOriginalTitle: normalizeExactString(entry.originalTitle || title),
    year,
    posterUrl: String(entry.posterUrl || ''),
    overview: String(entry.overview || ''),
  });

  try {
    if (typeof localStorage !== 'undefined') {
      const serialized = Array.from(runtimeD1TitleCatalog.values()).slice(-1500);
      localStorage.setItem(D1_TITLE_CATALOG_STORAGE_KEY, JSON.stringify(serialized));
    }
  } catch {
    // ignore storage quota errors
  }
}

function computeD1TitleMatchConfidence(
  queryNorm: string,
  queryYear: number | null,
  queryIsSeries: boolean | undefined,
  candidate: D1CatalogRecord
): number {
  if (!queryNorm || !candidate.normTitle) return 0;

  const candNorm = candidate.normTitle;
  const candOrigNorm = candidate.normOriginalTitle || candNorm;
  const typeAligned =
    queryIsSeries === undefined ||
    (queryIsSeries && candidate.typeCode === 's') ||
    (!queryIsSeries && candidate.typeCode === 'm');

  // 1. Exact normalized match
  if (queryNorm === candNorm || queryNorm === candOrigNorm) {
    if (queryYear && candidate.year) {
      const diff = Math.abs(queryYear - candidate.year);
      if (diff === 0) return typeAligned ? 100 : 92;
      if (diff === 1) return typeAligned ? 96 : 88;
      return typeAligned ? 86 : 78;
    }
    return typeAligned ? 95 : 86;
  }

  // 2. Token similarity & prefix match
  const qTokens = queryNorm.split(' ').filter(Boolean);
  const cTokens = candNorm.split(' ').filter(Boolean);
  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  const cSet = new Set(cTokens);
  const oSet = new Set(candOrigNorm.split(' ').filter(Boolean));
  let matchedInDe = 0;
  let matchedInOrig = 0;
  for (const t of qTokens) {
    if (cSet.has(t)) matchedInDe++;
    if (oSet.has(t)) matchedInOrig++;
  }

  const deRatio = matchedInDe / Math.max(qTokens.length, cTokens.length);
  const origRatio = matchedInOrig / Math.max(qTokens.length, oSet.size || 1);
  const bestRatio = Math.max(deRatio, origRatio);

  if (bestRatio < 0.65) return 0;

  let score = Math.round(bestRatio * 88);
  if (queryYear && candidate.year) {
    const diff = Math.abs(queryYear - candidate.year);
    if (diff === 0) score += 10;
    else if (diff === 1) score += 6;
    else score -= 8;
  }
  if (!typeAligned) {
    score -= 8;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Verifies entry existence in the local D1 catalog before triggering any external API calls.
 * Enforces an immediate 85% stop-limit: as soon as a D1 candidate reaches >= 85% match confidence,
 * the search stops immediately and returns the matched D1 record.
 */
export function checkDatabaseForExistingTitle(
  title: string,
  options?: {
    year?: number | string | null;
    isSeries?: boolean;
    kvNamespace?: SimulatedKVNamespace | null;
    stopConfidenceThreshold?: number;
  }
): D1ExistingTitleMatch {
  const stopLimit = options?.stopConfidenceThreshold ?? 85;
  ensureD1TitleCatalogSeeded(options?.kvNamespace);

  const parsed = normalizeMediaTitleForD1Lookup(title);
  const explicitYear = options?.year
    ? parseInt(String(options.year).slice(0, 4), 10) || null
    : null;
  const effectiveYear = explicitYear || parsed.year;
  const effectiveIsSeries =
    options?.isSeries !== undefined ? options.isSeries : parsed.isSeries ? true : undefined;

  if (!parsed.normTitle || parsed.normTitle.length < 2) {
    return {
      matched: false,
      confidence: 0,
      tmdbId: null,
      typeCode: effectiveIsSeries ? 's' : 'm',
      title: parsed.cleanTitle || title,
      year: effectiveYear,
      posterUrl: '',
      source: 'NONE',
    };
  }

  let bestCandidate: D1CatalogRecord | null = null;
  let bestConfidence = 0;

  for (const candidate of runtimeD1TitleCatalog.values()) {
    const conf = computeD1TitleMatchConfidence(
      parsed.normTitle,
      effectiveYear,
      effectiveIsSeries,
      candidate
    );
    if (conf > bestConfidence) {
      bestConfidence = conf;
      bestCandidate = candidate;
    }
    // Enforce the 85% stop-limit: stop searching immediately once >= 85% confidence is reached
    if (bestConfidence >= stopLimit && bestCandidate) {
      return {
        matched: true,
        confidence: bestConfidence,
        tmdbId: bestCandidate.tmdbId,
        typeCode: bestCandidate.typeCode,
        title: bestCandidate.title,
        year: bestCandidate.year,
        posterUrl: bestCandidate.posterUrl,
        overview: bestCandidate.overview,
        source: 'D1',
      };
    }
  }

  return {
    matched: false,
    confidence: bestConfidence,
    tmdbId: bestCandidate ? bestCandidate.tmdbId : null,
    typeCode: bestCandidate ? bestCandidate.typeCode : effectiveIsSeries ? 's' : 'm',
    title: bestCandidate ? bestCandidate.title : parsed.cleanTitle || title,
    year: bestCandidate ? bestCandidate.year : effectiveYear,
    posterUrl: bestCandidate ? bestCandidate.posterUrl : '',
    overview: bestCandidate?.overview,
    source: 'NONE',
  };
}

