window.QA_APP = {
  A: '../../assets/',
  stations: [
    { id:1, name:'The Gate', state:'complete', minutes:5, note:'Sealed at 9:04 by Warden Bram.' },
    { id:2, name:'Adventurer’s Outfitters', state:'complete', minutes:10, note:'You bought the wrong rope. It will matter later.' },
    { id:3, name:'The Scribe’s Hollow', state:'current', minutes:25, note:'Find the missing word on the fourth page.' },
    { id:4, name:'The River Crossing', state:'locked', minutes:20, note:'Unlocks once the Hollow is sealed.' },
    { id:5, name:'The Last Page', state:'locked', minutes:15, note:'Unlocks once the crossing is made.' },
  ],
  party: [
    { name:'Mara', role:'Chart-keeper', seals:7 },
    { name:'Idris', role:'Scribe', seals:6 },
    { name:'Wren', role:'Lookout', seals:7 },
    { name:'Tobias', role:'Bearer', seals:5 },
  ],
  seals: [
    { art:'crown', label:'Guildsworn', earned:true },
    { art:'compass', label:'Wayfinder', earned:true },
    { art:'relief', label:'Riverkeeper', earned:false },
    { art:'compass', label:'Pathfinder', earned:true },
    { art:'crown', label:'Oathbound', earned:false },
    { art:'relief', label:'Stonereader', earned:false },
  ],
};
