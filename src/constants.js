// Mirrors AniWorld-Downloader v5.4 (src/aniworld/web/sitesearch.py, config.py). Cineby and Streamtape were removed in v5.2.
const MOVIE_SITES = ['megakino', 'filmpalast', 'filmo', 'kinox', 'moflix'];
const SERIES_SITES = ['aniworld', 'sto', 'burningseries', 'kinox', 'moflix'];

// Languages each site offers; sending another one makes the download fail.
const SITE_LANGUAGES = {
  aniworld: ['German Dub', 'English Sub', 'German Sub', 'English Dub'],
  sto: ['German Dub', 'English Dub'],
  burningseries: ['German Dub', 'English Dub'],
  kinox: ['German Dub', 'English Dub'],
  filmpalast: ['German Dub', 'English Dub'],
  filmo: ['German Dub'],
  megakino: ['German Dub'],
  moflix: ['German Dub'],
};

module.exports = {
  LANGUAGES: ['German Dub', 'English Sub', 'German Sub', 'English Dub'],
  PROVIDERS: ['VOE', 'Vidoza', 'Doodstream', 'Filemoon', 'Vidmoly', 'Gupload', 'Vidara', 'MegaKino', 'MoflixClick'],
  MOVIE_SITES,
  SERIES_SITES,
  SITE_LANGUAGES,
  DEFAULT_LANGUAGE: 'German Dub',
  DEFAULT_PROVIDER: 'VOE',
  DEFAULT_MOVIE_SITES: 'megakino,filmpalast,filmo,moflix',
  DEFAULT_SERIES_SITES: 'aniworld,sto',
};
