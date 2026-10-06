// Local test adapter. This demo has no Supabase account or network dependency.
const CLOUD_FIELDS=['teamA','teamB','scoreA','scoreB','gameType','targetScore'];
const DEMO_KEY='dcl-count-up-chromebook-demo-v1';
let session={user:{email:'Demo player'}};
let demoMemory=null;
const demoInitial={matches:[],countUpAttempts:[],countUpDraft:{player:'',throws:[]},gameNights:[],teamA:'',teamB:'',scoreA:0,scoreB:0,gameType:'League',targetScore:21};
function configured(){return true}
function readSaved(){try{return JSON.parse(localStorage.getItem(DEMO_KEY))}catch{return demoMemory}}
function writeSaved(value){demoMemory=value;try{localStorage.setItem(DEMO_KEY,JSON.stringify(value))}catch{}}
async function readCloud(){const row=readSaved();if(row)return structuredClone(row);const first={revision:0,data:demoInitial};writeSaved(first);return structuredClone(first)}
async function updateCloud(change){const row=await readCloud();change(row.data);row.revision++;writeSaved(row);return structuredClone(row)}
async function signOut(){session={user:{email:'Demo player'}}}