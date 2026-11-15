//=======================================================================================
// Spotify Lyrics — 官方无歌词时补第三方歌词
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


// 繁 → 简折叠表（OpenCC t2s，Apache-2.0）。
//
// 只包含 BMP 内、繁简写法不同的字，以及 TSPhrases 里真正偏离字级映射的短语。
// 生成方式：
//   curl -O https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt
//   curl -O https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSPhrases.txt
//   再按 TSCharacters / TSPhrases 的首选项生成。
//
// 用法：
//   SPOTIFY_HAN_VARIANTS.fold(text)          无条件繁→简，用于曲名 / 歌手匹配
//   SPOTIFY_HAN_VARIANTS.isTraditional(text) 判断是否是繁体文本（含日文假名时视为否）
//
// 性能：字符表和短语表在第一次 fold 时才构建（约 3.4k 项，< 1ms）；
// 不含汉字的文本直接返回，不建表、不逐字扫描。
const SPOTIFY_HAN_VARIANTS = (() => {
  "use strict";

  // 两条字符串一一对应：TRAD[i] → SIMP[i]。
  const TRAD = [
    "㑯㑳㑶㓨㘚㜄㜏㠏㥮㩜㩳㩵䁻䃮䊷䋙䋚䋹䋻䍦䎱䙡䜀䝼䥇䥑䥱䦛䦟䯀䰾䱷䱽䲁䲘䴉丟並乾亂亙亞佇佈佔併來侖侶侷俁係俔俠俥俬倀倆倈倉個們倖倫倲偉偑側偵偽傌傑傖傘備傢傭傯傳傴",
    "債傷傾僂僅僉僑僕僞僥僨僱價儀儁儂億儈儉儎儐儔儕儘償優儲儷儸儺儻儼兇兌兒兗內兩冊冑冪凈凍凜凱別刪剄則剋剎剗剛剝剮剴創剷劃劄劇劉劊劌劍劏劑劚勁動務勛勝勞勢勩勱勳勵勸",
    "勻匭匯匱區協卹卻卽厙厠厤厭厲厴參叄叢吒吳吶呂咼員唄唸問啓啞啟啢喎喚喪喫喬單喲嗆嗇嗊嗎嗚嗩嗶嘆嘍嘓嘔嘖嘗嘜嘩嘮嘯嘰嘵嘸嘽噁噓噚噝噠噥噦噯噲噴噸噹嚀嚇嚌嚐嚕嚙嚥嚦嚨",
    "嚮嚲嚳嚴嚶囀囁囂囅囈囉囌囑囪圇國圍園圓圖團垻埡埰執堅堊堖堝堯報場塊塋塏塒塗塚塢塤塵塹墊墜墮墰墳墶墻墾壇壋壎壓壘壙壚壜壞壟壠壢壩壪壯壺壼壽夠夢夥夾奐奧奩奪奬奮奼妝",
    "姍姦娛婁婦婭媧媯媰媼媽嫋嫗嫵嫺嫻嫿嬀嬃嬈嬋嬌嬙嬡嬤嬪嬰嬸孃孋孌孫學孿宮寀寢實寧審寫寬寵寶將專尋對導尷屆屍屓屜屢層屨屬岡峯峴島峽崍崑崗崙崢崬嵐嵗嵾嶁嶄嶇嶔嶗嶠嶢嶧",
    "嶨嶮嶸嶺嶼嶽巋巒巔巖巰巹帥師帳帶幀幃幓幗幘幟幣幫幬幷幹幾庫廁廂廄廈廎廕廚廝廟廠廡廢廣廩廬廳弒弔弳張強彆彈彌彎彔彙彠彥彫彲彿後徑從徠復徵徹恆恥悅悞悵悶悽惡惱惲惻愛",
    "愜愨愴愷愾慄態慍慘慚慟慣慤慪慫慮慳慶慺慼慾憂憊憐憑憒憖憚憤憫憮憲憶懇應懌懍懞懟懣懤懨懲懶懷懸懺懼懾戀戇戔戧戩戰戱戲戶扞拋拚挩挱挾捨捫捱捲掃掄掆掗掙掛採揀揚換揮揯",
    "損搖搗搧搵搶摑摜摟摯摳摶摺摻撈撏撐撓撝撟撣撥撫撲撳撻撾撿擁擄擇擊擋擓擔據擠擡擣擬擯擰擱擲擴擷擺擻擼擽擾攄攆攏攔攖攙攛攜攝攢攣攤攪攬敎敓敗敘敵數斂斃斆斕斬斷於旂旣",
    "昇時晉晝暈暉暘暢暫曄曆曇曉曏曖曠曨曬書會朧朮東枴柵柺査桿梔梘條梟梲棄棊棖棗棟棡棧棲棶椏椲楊楓楨業極榘榦榪榮榲榿構槍槓槤槧槨槮槳槶槼樁樂樅樑樓標樞樢樣樧樫樳樸樹樺",
    "樿橈橋機橢橫檁檉檔檜檟檢檣檮檯檳檸檻櫃櫓櫚櫛櫝櫞櫟櫥櫧櫨櫪櫫櫬櫱櫳櫸櫻欄欅權欏欒欖欞欽歎歐歟歡歲歷歸歿殘殞殤殨殫殭殮殯殰殲殺殻殼毀毆毿氂氈氌氣氫氬氳氾汎汙決沒沖",
    "況泝洩洶浹涇涗涼淒淚淥淨淩淪淵淶淺渙減渢渦測渾湊湞湧湯溈準溝溫溮溳溼滄滅滌滎滙滬滯滲滷滸滻滾滿漁漊漚漢漣漬漲漵漸漿潁潑潔潙潚潛潤潯潰潷潿澀澆澇澐澗澠澤澦澩澮澱澾",
    "濁濃濄濕濘濚濛濜濟濤濧濫濰濱濺濼濾瀂瀅瀆瀇瀉瀋瀏瀕瀘瀝瀟瀠瀦瀧瀨瀰瀲瀾灃灄灑灕灘灝灡灣灤灧灩災為烏烴無煉煒煙煢煥煩煬煱熅熒熗熱熲熾燁燈燉燒燙燜營燦燬燭燴燶燻燼燾",
    "爍爐爛爭爲爺爾牀牆牘牴牽犖犛犢犧狀狹狽猙猶猻獁獃獄獅獎獨獪獫獮獰獱獲獵獷獸獺獻獼玀現琱琺琿瑋瑒瑣瑤瑩瑪瑲璉璡璣璦璫璯環璵璸璽璿瓊瓏瓔瓚甌甕產産畝畢畫異畵當疇疊痙",
    "痠痾瘂瘋瘍瘓瘞瘡瘧瘮瘲瘺瘻療癆癇癉癒癘癟癡癢癤癥癧癩癬癭癮癰癱癲發皁皚皰皸皺盃盜盞盡監盤盧盪眞眥眾睏睜睞瞘瞜瞞瞶瞼矇矓矚矯硃硜硤硨硯碕碩碭碸確碼碽磑磚磠磣磧磯磽",
    "磾礄礎礙礦礪礫礬礱祕祿禍禎禕禡禦禪禮禰禱禿秈稅稈稏稜稟種稱穀穇穌積穎穠穡穢穩穫穭窩窪窮窯窵窶窺竄竅竇竈竊竪競筆筍筧筴箇箋箏箚節範築篋篔篠篤篩篳簀簍簑簞簡簣簫簹簽",
    "簾籃籌籔籙籛籜籟籠籤籩籪籬籮籲粵糉糝糞糧糰糲糴糶糹糾紀紂約紅紆紇紈紉紋納紐紓純紕紖紗紘紙級紛紜紝紡紬紮細紱紲紳紵紹紺紼紿絀終絃組絅絆絎結絕絛絝絞絡絢給絨絰統絲絳",
    "絶絹綁綃綆綈綉綌綏綐綑經綜綞綠綢綣綫綬維綯綰綱網綳綴綵綸綹綺綻綽綾綿緄緇緊緋緑緒緓緔緗緘緙線緝緞締緡緣緦編緩緬緯緱緲練緶緹緻緼縈縉縊縋縐縑縕縗縛縝縞縟縣縧縫縭縮",
    "縱縲縳縴縵縶縷縹總績繃繅繆繒織繕繚繞繡繢繩繪繫繭繮繯繰繳繸繹繼繽繾繿纇纈纊續纍纏纓纔纖纘纜缽罃罈罌罎罰罵罷羅羆羈羋羣羥羨義羶習翫翬翹翽耬耮聖聞聯聰聲聳聵聶職聹聽",
    "聾肅脅脈脛脣脩脫脹腎腖腡腦腫腳腸膃膕膚膞膠膩膽膾膿臉臍臏臘臚臟臠臢臥臨臺與興舉舊舖舘艙艤艦艫艱艷芻苧茲荊莊莖莢莧華菴菸萇萊萬萴萵葉葒葤葦葯葷蒐蒓蒔蒕蒞蒼蓀蓆蓋蓮",
    "蓯蓴蓽蔔蔘蔞蔣蔥蔦蔭蕁蕆蕎蕒蕓蕕蕘蕢蕩蕪蕭蕷薀薈薊薌薑薔薘薟薦薩薴薵薹薺藍藎藝藥藪藭藴藶藹藺蘀蘄蘆蘇蘊蘋蘚蘞蘢蘭蘺蘿虆處虛虜號虧虯蛺蛻蜆蝕蝟蝦蝨蝸螄螞螢螮螻螿蟄",
    "蟈蟎蟣蟬蟯蟲蟶蟻蠁蠅蠆蠍蠐蠑蠔蠟蠣蠨蠱蠶蠻衆衊術衕衚衛衝袞袷裊裏補裝裡製複褌褘褲褳褸褻襇襉襏襖襝襠襤襪襬襯襲襴覈見覎規覓視覘覡覥覦親覬覯覲覷覺覽覿觀觴觶觸訁訂訃",
    "計訊訌討訐訒訓訕訖託記訛訝訟訢訣訥訩訪設許訴訶診註証詁詆詎詐詒詔評詖詗詘詛詞詠詡詢詣試詩詫詬詭詮詰話該詳詵詼詿誄誅誆誇誌認誑誒誕誘誚語誠誡誣誤誥誦誨說説誰課誶誹",
    "誼誾調諂諄談諉請諍諏諑諒論諗諛諜諝諞諡諢諤諦諧諫諭諮諱諳諶諷諸諺諼諾謀謁謂謄謅謊謎謐謔謖謗謙謚講謝謠謡謨謫謬謭謳謹謾譁證譎譏譖識譙譚譜譟譫譭譯議譴護譸譽譾讀讅變",
    "讋讌讎讒讓讕讖讚讜讞谿豈豎豐豔豬豶貍貓貙貝貞貟負財貢貧貨販貪貫責貯貰貲貳貴貶買貸貺費貼貽貿賀賁賂賃賄賅資賈賊賑賒賓賕賙賚賜賞賠賡賢賣賤賦賧質賫賬賭賰賴賵賺賻購賽",
    "賾贄贅贇贈贊贋贍贏贐贓贔贖贗贛贜赬趕趙趨趲跡踐踰踴蹌蹕蹟蹠蹣蹤蹺躂躉躊躋躍躎躑躒躓躕躚躡躥躦躪軀車軋軌軍軑軒軔軛軟軤軫軲軸軹軺軻軼軾較輅輇輈載輊輒輓輔輕輛輜輝輞",
    "輟輥輦輩輪輬輯輳輸輻輼輾輿轀轂轄轅轆轉轍轎轔轟轡轢轤辦辭辮辯農迴逕這連週進遊運過達違遙遜遞遠遡適遲遶遷選遺遼邁還邇邊邏邐郟郵鄆鄉鄒鄔鄖鄧鄭鄰鄲鄴鄶鄺酇酈醃醖醜醞",
    "醟醣醫醬醱釀釁釃釅釋釐釒釓釔釕釗釘釙針釣釤釦釧釩釵釷釹釺釾鈀鈁鈃鈄鈅鈈鈉鈍鈎鈐鈑鈒鈔鈕鈞鈡鈣鈥鈦鈧鈮鈰鈳鈴鈷鈸鈹鈺鈽鈾鈿鉀鉅鉆鉈鉉鉋鉍鉑鉕鉗鉚鉛鉞鉢鉤鉦鉬鉭鉳鉶",
    "鉸鉺鉻鉿銀銃銅銍銑銓銖銘銚銛銜銠銣銥銦銨銩銪銫銬銱銳銷銹銻銼鋁鋃鋅鋇鋌鋏鋒鋙鋝鋟鋣鋤鋥鋦鋨鋩鋪鋭鋮鋯鋰鋱鋶鋸鋼錁錄錆錇錈錏錐錒錕錘錙錚錛錟錠錡錢錦錨錩錫錮錯録錳",
    "錶錸錼鍀鍁鍃鍅鍆鍇鍈鍊鍋鍍鍔鍘鍚鍛鍠鍤鍥鍩鍬鍰鍵鍶鍺鍼鍾鎂鎄鎇鎊鎌鎔鎖鎘鎚鎛鎡鎢鎣鎦鎧鎩鎪鎬鎭鎮鎰鎲鎳鎵鎶鎸鎿鏃鏇鏈鏌鏍鏐鏑鏗鏘鏜鏝鏞鏟鏡鏢鏤鏨鏰鏵鏷鏹鏺鏽鐃鐋",
    "鐐鐒鐓鐔鐘鐙鐝鐠鐥鐦鐧鐨鐫鐮鐯鐲鐳鐵鐶鐸鐺鐿鑄鑊鑌鑑鑒鑔鑕鑞鑠鑣鑥鑭鑰鑱鑲鑷鑹鑼鑽鑾鑿钁钂長門閂閃閆閈閉開閌閎閏閑閒間閔閘閡閣閤閥閨閩閫閬閭閱閲閶閹閻閼閽閾閿闃",
    "闆闇闈闊闋闌闍闐闒闓闔闕闖關闞闠闡闢闤闥陘陝陞陣陰陳陸陽隉隊階隕際隨險隯隱隴隸隻雋雖雙雛雜雞離難雲電霑霢霧霽靂靄靆靈靉靚靜靝靦靨鞏鞝鞦鞽韁韃韆韉韋韌韍韓韙韜韝韞",
    "韻響頁頂頃項順頇須頊頌頎頏預頑頒頓頗領頜頡頤頦頭頮頰頲頴頷頸頹頻頽顆題額顎顏顒顓顔願顙顛類顢顥顧顫顬顯顰顱顳顴風颭颮颯颱颳颶颸颺颻颼飀飄飆飈飛飠飢飣飥飩飪飫飭飯",
    "飱飲飴飼飽飾飿餃餄餅餈餉養餌餎餏餑餒餓餕餖餘餚餛餜餞餡館餬餱餳餵餶餷餺餼餾餿饁饃饅饈饉饊饋饌饑饒饗饜饞饢馬馭馮馱馳馴馹駁駐駑駒駔駕駘駙駛駝駟駡駢駭駰駱駸駿騁騂騅",
    "騌騍騎騏騖騙騤騧騫騭騮騰騶騷騸騾驀驁驂驃驄驅驊驌驍驏驕驗驚驛驟驢驤驥驦驪驫骯髏髒體髕髖髮鬆鬍鬚鬢鬥鬧鬨鬩鬮鬱鬹魎魘魚魛魢魨魯魴魷魺鮁鮃鮊鮋鮍鮎鮐鮑鮒鮓鮚鮜鮝鮞鮣",
    "鮦鮪鮫鮭鮮鮳鮶鮺鯀鯁鯇鯉鯊鯒鯔鯕鯖鯗鯛鯝鯡鯢鯤鯧鯨鯪鯫鯰鯴鯷鯽鯿鰁鰂鰃鰆鰈鰉鰌鰍鰏鰐鰒鰓鰛鰜鰟鰠鰣鰥鰧鰨鰩鰭鰮鰱鰲鰳鰵鰷鰹鰺鰻鰼鰾鱂鱅鱈鱉鱒鱔鱖鱗鱘鱝鱟鱠鱣鱤鱧",
    "鱨鱭鱯鱷鱸鱺鳥鳧鳩鳬鳲鳳鳴鳶鳾鴆鴇鴉鴒鴕鴛鴝鴞鴟鴣鴦鴨鴯鴰鴴鴷鴻鴿鵁鵂鵃鵐鵑鵒鵓鵜鵝鵠鵡鵪鵬鵮鵯鵰鵲鵷鵾鶄鶇鶉鶊鶓鶖鶘鶚鶡鶥鶩鶪鶬鶯鶲鶴鶹鶺鶻鶼鶿鷀鷁鷂鷄鷉鷊鷓",
    "鷖鷗鷙鷚鷥鷦鷫鷯鷲鷳鷴鷸鷹鷺鷽鸂鸇鸊鸌鸏鸕鸘鸚鸛鸝鸞鹵鹹鹺鹼鹽麗麥麩麪麫麯麴麵麼麽黃黌點黨黲黴黶黷黽黿鼂鼉鼕鼴齊齋齎齏齒齔齕齗齙齜齟齠齡齣齦齧齪齬齲齶齷龍龎龐龑",
    "龔龕龜鿁鿓",
  ].join("");
  const SIMP = [
    "㑔㑇㐹刾㘎㚯㛣㟆㤘㨫㧐擜䀥鿎䌶䌺䌻䌿䌾䍠䎬䙌䜧䞍䦂鿏䥾䦶䦷䯅鲃䲣䲝鳚鳤鹮丢并干乱亘亚伫布占并来仑侣局俣系伣侠伡私伥俩俫仓个们幸伦㑈伟㐽侧侦伪㐷杰伧伞备家佣偬传伛",
    "债伤倾偻仅佥侨仆伪侥偾雇价仪俊侬亿侩俭傤傧俦侪尽偿优储俪㑩傩傥俨凶兑儿兖内两册胄幂净冻凛凯别删刭则克刹刬刚剥剐剀创铲划札剧刘刽刿剑㓥剂㔉劲动务勋胜劳势勚劢勋励劝",
    "匀匦汇匮区协恤却即厍厕历厌厉厣参叁丛咤吴呐吕呙员呗念问启哑启唡㖞唤丧吃乔单哟呛啬唝吗呜唢哔叹喽啯呕啧尝唛哗唠啸叽哓呒啴恶嘘㖊咝哒哝哕嗳哙喷吨当咛吓哜尝噜啮咽呖咙",
    "向亸喾严嘤啭嗫嚣冁呓啰苏嘱囱囵国围园圆图团坝垭采执坚垩垴埚尧报场块茔垲埘涂冢坞埙尘堑垫坠堕坛坟垯墙垦坛垱埙压垒圹垆坛坏垄垅坜坝塆壮壶壸寿够梦伙夹奂奥奁夺奖奋姹妆",
    "姗奸娱娄妇娅娲妫㛀媪妈袅妪妩娴娴婳妫媭娆婵娇嫱嫒嬷嫔婴婶娘㛤娈孙学孪宫采寝实宁审写宽宠宝将专寻对导尴届尸屃屉屡层屦属冈峰岘岛峡崃昆岗仑峥岽岚岁㟥嵝崭岖嵚崂峤峣峄",
    "峃崄嵘岭屿岳岿峦巅岩巯卺帅师帐带帧帏㡎帼帻帜币帮帱并干几库厕厢厩厦庼荫厨厮庙厂庑废广廪庐厅弑吊弪张强别弹弥弯录汇彟彦雕彨佛后径从徕复征彻恒耻悦悮怅闷凄恶恼恽恻爱",
    "惬悫怆恺忾栗态愠惨惭恸惯悫怄怂虑悭庆㥪戚欲忧惫怜凭愦慭惮愤悯怃宪忆恳应怿懔蒙怼懑㤽恹惩懒怀悬忏惧慑恋戆戋戗戬战戯戏户捍抛拼捝挲挟舍扪挨卷扫抡㧏挜挣挂采拣扬换挥搄",
    "损摇捣扇揾抢掴掼搂挚抠抟折掺捞挦撑挠㧑挢掸拨抚扑揿挞挝捡拥掳择击挡㧟担据挤抬捣拟摈拧搁掷扩撷摆擞撸㧰扰摅撵拢拦撄搀撺携摄攒挛摊搅揽教敚败叙敌数敛毙敩斓斩断于旗既",
    "升时晋昼晕晖旸畅暂晔历昙晓向暧旷昽晒书会胧术东拐栅拐查杆栀枧条枭棁弃棋枨枣栋㭎栈栖梾桠㭏杨枫桢业极矩干杩荣榅桤构枪杠梿椠椁椮桨椢椝桩乐枞梁楼标枢㭤样榝㭴桪朴树桦",
    "椫桡桥机椭横檩柽档桧槚检樯梼台槟柠槛柜橹榈栉椟橼栎橱槠栌枥橥榇蘖栊榉樱栏榉权椤栾榄棂钦叹欧欤欢岁历归殁残殒殇㱮殚僵殓殡㱩歼杀壳壳毁殴毵牦毡氇气氢氩氲泛泛污决没冲",
    "况溯泄汹浃泾涚凉凄泪渌净凌沦渊涞浅涣减沨涡测浑凑浈涌汤沩准沟温浉涢湿沧灭涤荥汇沪滞渗卤浒浐滚满渔溇沤汉涟渍涨溆渐浆颍泼洁沩㴋潜润浔溃滗涠涩浇涝沄涧渑泽滪泶浍淀㳠",
    "浊浓㳡湿泞溁蒙浕济涛㳔滥潍滨溅泺滤澛滢渎㲿泻沈浏濒泸沥潇潆潴泷濑弥潋澜沣滠洒漓滩灏㳕湾滦滟滟灾为乌烃无炼炜烟茕焕烦炀㶽煴荧炝热颎炽烨灯炖烧烫焖营灿毁烛烩㶶熏烬焘",
    "烁炉烂争为爷尔床墙牍抵牵荦牦犊牺状狭狈狰犹狲犸呆狱狮奖独狯猃狝狞㺍获猎犷兽獭献猕猡现雕珐珲玮玚琐瑶莹玛玱琏琎玑瑷珰㻅环玙瑸玺璇琼珑璎瓒瓯瓮产产亩毕画异画当畴叠痉",
    "酸疴痖疯疡痪瘗疮疟瘆疭瘘瘘疗痨痫瘅愈疠瘪痴痒疖症疬癞癣瘿瘾痈瘫癫发皂皑疱皲皱杯盗盏尽监盘卢荡真眦众困睁睐眍䁖瞒瞆睑蒙眬瞩矫朱硁硖砗砚埼硕砀砜确码䂵硙砖硵碜碛矶硗",
    "䃅硚础碍矿砺砾矾砻秘禄祸祯祎祃御禅礼祢祷秃籼税秆䅉棱禀种称谷䅟稣积颖秾穑秽稳获穞窝洼穷窑窎窭窥窜窍窦灶窃竖竞笔笋笕䇲个笺筝札节范筑箧筼筿笃筛筚箦篓蓑箪简篑箫筜签",
    "帘篮筹䉤箓篯箨籁笼签笾簖篱箩吁粤粽糁粪粮团粝籴粜纟纠纪纣约红纡纥纨纫纹纳纽纾纯纰纼纱纮纸级纷纭纴纺䌷扎细绂绁绅纻绍绀绋绐绌终弦组䌹绊绗结绝绦绔绞络绚给绒绖统丝绛",
    "绝绢绑绡绠绨绣绤绥䌼捆经综缍绿绸绻线绶维绹绾纲网绷缀彩纶绺绮绽绰绫绵绲缁紧绯绿绪绬绱缃缄缂线缉缎缔缗缘缌编缓缅纬缑缈练缏缇致缊萦缙缢缒绉缣缊缞缚缜缟缛县绦缝缡缩",
    "纵缧䌸纤缦絷缕缥总绩绷缫缪缯织缮缭绕绣缋绳绘系茧缰缳缲缴䍁绎继缤缱䍀颣缬纩续累缠缨才纤缵缆钵䓨坛罂坛罚骂罢罗罴羁芈群羟羡义膻习玩翚翘翙耧耢圣闻联聪声耸聩聂职聍听",
    "聋肃胁脉胫唇修脱胀肾胨脶脑肿脚肠腽腘肤䏝胶腻胆脍脓脸脐膑腊胪脏脔臜卧临台与兴举旧铺馆舱舣舰舻艰艳刍苎兹荆庄茎荚苋华庵烟苌莱万荝莴叶荭荮苇药荤搜莼莳蒀莅苍荪席盖莲",
    "苁莼荜卜参蒌蒋葱茑荫荨蒇荞荬芸莸荛蒉荡芜萧蓣蕰荟蓟芗姜蔷荙莶荐萨苧䓓苔荠蓝荩艺药薮䓖蕴苈蔼蔺萚蕲芦苏蕴苹藓蔹茏兰蓠萝蔂处虚虏号亏虬蛱蜕蚬蚀猬虾虱蜗蛳蚂萤䗖蝼螀蛰",
    "蝈螨虮蝉蛲虫蛏蚁蚃蝇虿蝎蛴蝾蚝蜡蛎蟏蛊蚕蛮众蔑术同胡卫冲衮夹袅里补装里制复裈袆裤裢褛亵裥裥袯袄裣裆褴袜摆衬袭襕核见觃规觅视觇觋觍觎亲觊觏觐觑觉览觌观觞觯触讠订讣",
    "计讯讧讨讦讱训讪讫托记讹讶讼䜣诀讷讻访设许诉诃诊注证诂诋讵诈诒诏评诐诇诎诅词咏诩询诣试诗诧诟诡诠诘话该详诜诙诖诔诛诓夸志认诳诶诞诱诮语诚诫诬误诰诵诲说说谁课谇诽",
    "谊訚调谄谆谈诿请诤诹诼谅论谂谀谍谞谝谥诨谔谛谐谏谕咨讳谙谌讽诸谚谖诺谋谒谓誊诌谎谜谧谑谡谤谦谥讲谢谣谣谟谪谬谫讴谨谩哗证谲讥谮识谯谭谱噪谵毁译议谴护诪誉谫读谉变",
    "詟䜩雠谗让谰谶赞谠谳溪岂竖丰艳猪豮狸猫䝙贝贞贠负财贡贫货贩贪贯责贮贳赀贰贵贬买贷贶费贴贻贸贺贲赂赁贿赅资贾贼赈赊宾赇赒赉赐赏赔赓贤卖贱赋赕质赍账赌䞐赖赗赚赙购赛",
    "赜贽赘赟赠赞赝赡赢赆赃赑赎赝赣赃赪赶赵趋趱迹践逾踊跄跸迹跖蹒踪跷跶趸踌跻跃䟢踯跞踬蹰跹蹑蹿躜躏躯车轧轨军轪轩轫轭软轷轸轱轴轵轺轲轶轼较辂辁辀载轾辄挽辅轻辆辎辉辋",
    "辍辊辇辈轮辌辑辏输辐辒辗舆辒毂辖辕辘转辙轿辚轰辔轹轳办辞辫辩农回径这连周进游运过达违遥逊递远溯适迟绕迁选遗辽迈还迩边逻逦郏邮郓乡邹邬郧邓郑邻郸邺郐邝酂郦腌酝丑酝",
    "蒏糖医酱酦酿衅酾酽释厘钅钆钇钌钊钉钋针钓钐扣钏钒钗钍钕钎䥺钯钫钘钭钥钚钠钝钩钤钣钑钞钮钧钟钙钬钛钪铌铈钶铃钴钹铍钰钸铀钿钾巨钻铊铉铇铋铂钷钳铆铅钺钵钩钲钼钽锫铏",
    "铰铒铬铪银铳铜铚铣铨铢铭铫铦衔铑铷铱铟铵铥铕铯铐铞锐销锈锑锉铝锒锌钡铤铗锋铻锊锓铘锄锃锔锇铓铺锐铖锆锂铽锍锯钢锞录锖锫锩铔锥锕锟锤锱铮锛锬锭锜钱锦锚锠锡锢错录锰",
    "表铼镎锝锨锪钫钔锴锳炼锅镀锷铡钖锻锽锸锲锘锹锾键锶锗针钟镁锿镅镑镰镕锁镉锤镈镃钨蓥镏铠铩锼镐镇镇镒镋镍镓鿔镌镎镞旋链镆镙镠镝铿锵镗镘镛铲镜镖镂錾镚铧镤镪䥽锈铙铴",
    "镣铹镦镡钟镫镢镨䦅锎锏镄镌镰䦃镯镭铁镮铎铛镱铸镬镔鉴鉴镲锧镴铄镳镥镧钥镵镶镊镩锣钻銮凿镢镋长门闩闪闫闬闭开闶闳闰闲闲间闵闸阂阁合阀闺闽阃阆闾阅阅阊阉阎阏阍阈阌阒",
    "板暗闱阔阕阑阇阗阘闿阖阙闯关阚阓阐辟阛闼陉陕升阵阴陈陆阳陧队阶陨际随险陦隐陇隶只隽虽双雏杂鸡离难云电沾霡雾霁雳霭叇灵叆靓静靔腼靥巩绱秋鞒缰鞑千鞯韦韧韨韩韪韬鞲韫",
    "韵响页顶顷项顺顸须顼颂颀颃预顽颁顿颇领颌颉颐颏头颒颊颋颕颔颈颓频颓颗题额颚颜颙颛颜愿颡颠类颟颢顾颤颥显颦颅颞颧风飐飑飒台刮飓飔飏飖飕飗飘飙飚飞饣饥饤饦饨饪饫饬饭",
    "飧饮饴饲饱饰饳饺饸饼糍饷养饵饹饻饽馁饿馂饾余肴馄馃饯馅馆糊糇饧喂馉馇馎饩馏馊馌馍馒馐馑馓馈馔饥饶飨餍馋馕马驭冯驮驰驯驲驳驻驽驹驵驾骀驸驶驼驷骂骈骇骃骆骎骏骋骍骓",
    "骔骒骑骐骛骗骙䯄骞骘骝腾驺骚骟骡蓦骜骖骠骢驱骅骕骁骣骄验惊驿骤驴骧骥骦骊骉肮髅脏体髌髋发松胡须鬓斗闹哄阋阄郁鬶魉魇鱼鱽鱾鲀鲁鲂鱿鲄鲅鲆鲌鲉鲏鲇鲐鲍鲋鲊鲒鲘鲞鲕䲟",
    "鲖鲔鲛鲑鲜鲓鲪鲝鲧鲠鲩鲤鲨鲬鲻鲯鲭鲞鲷鲴鲱鲵鲲鲳鲸鲮鲰鲶鲺鳀鲫鳊鳈鲗鳂䲠鲽鳇䲡鳅鲾鳄鳆鳃鳁鳒鳑鳋鲥鳏䲢鳎鳐鳍鳁鲢鳌鳓鳘鲦鲣鲹鳗鳛鳔鳉鳙鳕鳖鳟鳝鳜鳞鲟鲼鲎鲙鳣鳡鳢",
    "鲿鲚鳠鳄鲈鲡鸟凫鸠凫鸤凤鸣鸢䴓鸩鸨鸦鸰鸵鸳鸲鸮鸱鸪鸯鸭鸸鸹鸻䴕鸿鸽䴔鸺鸼鹀鹃鹆鹁鹈鹅鹄鹉鹌鹏鹐鹎雕鹊鹓鹍䴖鸫鹑鹒鹋鹙鹕鹗鹖鹛鹜䴗鸧莺鹟鹤鹠鹡鹘鹣鹚鹚鹢鹞鸡䴘鹝鹧",
    "鹥鸥鸷鹨鸶鹪鹔鹩鹫鹇鹇鹬鹰鹭鸴㶉鹯䴙鹱鹲鸬鹴鹦鹳鹂鸾卤咸鹾碱盐丽麦麸面面曲曲面么么黄黉点党黪霉黡黩黾鼋鼌鼍冬鼹齐斋赍齑齿龀龁龂龅龇龃龆龄出龈啮龊龉龋腭龌龙厐庞䶮",
    "龚龛龟䜤鿒",
  ].join("");

  // 字级映射有歧义的短语（乾隆 / 乾坤 / 著名 / 藉口 / 慰藉…），优先于单字。
  const PHRASES = [
    "一坏 一坯",
    "一目瞭然 一目了然",
    "七逕 七迳",
    "上逕 上迳",
    "上鍊 上链",
    "不瞭解 不了解",
    "么麼 幺麽",
    "么麽 幺麽",
    "九逕山 九迳山",
    "乾亨 乾亨",
    "乾佑縣 乾佑县",
    "乾元 乾元",
    "乾化三年 乾化三年",
    "乾化二年 乾化二年",
    "乾化五年 乾化五年",
    "乾化元年 乾化元年",
    "乾化四年 乾化四年",
    "乾化年間 乾化年间",
    "乾卦 乾卦",
    "乾嘉 乾嘉",
    "乾圖 乾图",
    "乾坤 乾坤",
    "乾坤一擲 乾坤一掷",
    "乾坤再造 乾坤再造",
    "乾坤大挪移 乾坤大挪移",
    "乾宅 乾宅",
    "乾安縣 乾安县",
    "乾安鎮 乾安镇",
    "乾定 乾定",
    "乾寧 乾宁",
    "乾封 乾封",
    "乾州 乾州",
    "乾德 乾德",
    "乾斷 乾断",
    "乾旦 乾旦",
    "乾明 乾明",
    "乾曜 乾曜",
    "乾清宮 乾清宫",
    "乾盛世 乾盛世",
    "乾祐 乾祐",
    "乾符 乾符",
    "乾統 乾统",
    "乾綱 乾纲",
    "乾縣 乾县",
    "乾興 乾兴",
    "乾象 乾象",
    "乾造 乾造",
    "乾道 乾道",
    "乾闥婆 乾闼婆",
    "乾陵 乾陵",
    "乾隆 乾隆",
    "乾隆年間 乾隆年间",
    "乾隆皇帝 乾隆皇帝",
    "以免藉口 以免借口",
    "傢俱 家具",
    "允祕 允祕",
    "八濛山 八濛山",
    "其陰多蒐 其阴多蒐",
    "凌藉 凌借",
    "函覆 函复",
    "剋架 剋架",
    "剋毒 剋毒",
    "千鍾粟 千锺粟",
    "南氾 南氾",
    "南逕 南迳",
    "反反覆覆 反反复复",
    "反覆 反复",
    "反覆思維 反复思维",
    "反覆思量 反复思量",
    "反覆性 反复性",
    "名覆金甌 名复金瓯",
    "吳祕 吴祕",
    "吳育昇 吴育昇",
    "哪吒 哪吒",
    "回覆 回复",
    "土坏 土坯",
    "坏土 坯土",
    "坏子 坯子",
    "坏布 坯布",
    "坏戶 坯户",
    "墨沈沈 墨沉沉",
    "壺裏乾坤 壶里乾坤",
    "夥多 夥多",
    "夥頤 夥颐",
    "大目乾連冥間救母變文 大目乾连冥间救母变文",
    "宫商角徵羽 宫商角徵羽",
    "尼乾子 尼乾子",
    "尼乾陀 尼乾陀",
    "年釐 年釐",
    "幺麼 幺麽",
    "幺麼小丑 幺麽小丑",
    "幺麼小醜 幺麽小丑",
    "康乾 康乾",
    "張昇 张昇",
    "張法乾 张法乾",
    "彷彿 仿佛",
    "後梁乾化 后梁乾化",
    "徐胤昇 徐胤昇",
    "復甦 复苏",
    "徵弦 徵弦",
    "徵絃 徵弦",
    "徵羽摩柯 徵羽摩柯",
    "徵聲 徵声",
    "徵調 徵调",
    "徵音 徵音",
    "意志消沈 意志消沉",
    "憑藉 凭借",
    "憑藉着 凭借着",
    "懷釐 怀釐",
    "手鍊 手链",
    "打坏 打坯",
    "扞格 扞格",
    "扭轉乾坤 扭转乾坤",
    "批覆 批复",
    "找藉口 找借口",
    "折戟沈沙 折戟沉沙",
    "折戟沈河 折戟沉河",
    "拉坏 拉坯",
    "拉鍊 拉链",
    "拉鍊工程 拉链工程",
    "拜覆 拜复",
    "挨剋 挨剋",
    "捏坏 捏坯",
    "擊沈 击沉",
    "據瞭解 据了解",
    "於世成 於世成",
    "於乎 於乎",
    "於仲完 於仲完",
    "於倫 於伦",
    "於其一 於其一",
    "於則 於则",
    "於勇明 於勇明",
    "於呼哀哉 於呼哀哉",
    "於單 於单",
    "於坦 於坦",
    "於崇文 於崇文",
    "於忠祥 於忠祥",
    "於惟一 於惟一",
    "於戲 於戏",
    "於敖 於敖",
    "於梨華 於梨华",
    "於清言 於清言",
    "於潛 於潜",
    "於琳 於琳",
    "於穆 於穆",
    "於竹屋 於竹屋",
    "於菟 於菟",
    "於邑 於邑",
    "於陵子 於陵子",
    "旋乾轉坤 旋乾转坤",
    "旋轉乾坤 旋转乾坤",
    "旋轉乾坤之力 旋转乾坤之力",
    "明瞭 明了",
    "明覆 明复",
    "昏沈 昏沉",
    "春蒐 春蒐",
    "春釐 春釐",
    "暗沈沈 暗沉沉",
    "書中自有千鍾粟 书中自有千锺粟",
    "朝乾夕惕 朝乾夕惕",
    "木吒 木吒",
    "李乾德 李乾德",
    "李昇 李昇",
    "李昇勳 李昇勋",
    "李澤鉅 李泽钜",
    "李祕 李祕",
    "李鍊福 李链福",
    "李鍾郁 李锺郁",
    "束脩 束脩",
    "東氾 东氾",
    "梁乾化 梁乾化",
    "梁昇卿 梁昇卿",
    "梁章鉅 梁章钜",
    "楊聯陞 杨联陞",
    "樊於期 樊於期",
    "死氣沈沈 死气沉沉",
    "段脩 段脩",
    "毛坏 毛坯",
    "水逕 水迳",
    "氾勝之 氾胜之",
    "氾南 氾南",
    "氾國 氾国",
    "氾水 氾水",
    "沈下 沉下",
    "沈不住氣 沉不住气",
    "沈住氣 沉住气",
    "沈冤 沉冤",
    "沈厚 沉厚",
    "沈吟 沉吟",
    "沈寂 沉寂",
    "沈得住氣 沉得住气",
    "沈思 沉思",
    "沈思往事 沉思往事",
    "沈悶 沉闷",
    "沈沒 沉没",
    "沈沒成本 沉没成本",
    "沈浮 沉浮",
    "沈浸 沉浸",
    "沈浸於 沉浸于",
    "沈淪 沉沦",
    "沈湎 沉湎",
    "沈湎酒色 沉湎酒色",
    "沈溺 沉溺",
    "沈滯 沉滞",
    "沈滯性 沉滞性",
    "沈澱 沉淀",
    "沈澱出來 沉淀出来",
    "沈澱劑 沉淀剂",
    "沈澱法 沉淀法",
    "沈澱物 沉淀物",
    "沈濁 沉浊",
    "沈甸甸 沉甸甸",
    "沈痛 沉痛",
    "沈痼 沉痼",
    "沈痾 沉疴",
    "沈睡 沉睡",
    "沈睡不醒 沉睡不醒",
    "沈砂池 沉砂池",
    "沈積 沉积",
    "沈積岩 沉积岩",
    "沈積石 沉积石",
    "沈筒 沉筒",
    "沈船 沉船",
    "沈落 沉落",
    "沈迷 沉迷",
    "沈迷不醒 沉迷不醒",
    "沈醉 沉醉",
    "沈重 沉重",
    "沈降 沉降",
    "沈陷 沉陷",
    "沈靜 沉静",
    "沈靜下來 沉静下来",
    "沈香 沉香",
    "沈鬱 沉郁",
    "沈魚落雁 沉鱼落雁",
    "沈默 沉默",
    "沈默不語 沉默不语",
    "沈默寡言 沉默寡言",
    "沙逕 沙迳",
    "河逕 河迳",
    "流徵 流徵",
    "浪蕩乾坤 浪荡乾坤",
    "浮沈 浮沉",
    "海哩 海里",
    "深沈 深沉",
    "深沈不露 深沉不露",
    "溫昇豪 温昇豪",
    "滑藉 滑借",
    "烏昇 乌昇",
    "烏沈沈 乌沉沉",
    "烏逕 乌迳",
    "狐藉虎威 狐借虎威",
    "王彥昇 王彦昇",
    "珍珠項鍊 珍珠项链",
    "甚夥 甚夥",
    "甚鉅 甚钜",
    "甦生 苏生",
    "甦醒 苏醒",
    "申昇勳 申昇勋",
    "申覆 申复",
    "畢昇 毕昇",
    "盧象昇 卢象昇",
    "目劄 目劄",
    "瞭如 了如",
    "瞭如指掌 了如指掌",
    "瞭然 了然",
    "瞭然於心 了然于心",
    "瞭若指掌 了若指掌",
    "瞭解 了解",
    "瞭解到 了解到",
    "破釜沈舟 破釜沉舟",
    "磚坏 砖坯",
    "示覆 示复",
    "社逕 社迳",
    "祕丕笈 祕丕笈",
    "祕彭祖 祕彭祖",
    "祕瓊 祕琼",
    "祝釐 祝釐",
    "稟覆 禀复",
    "竺乾 竺乾",
    "答覆 答复",
    "篤麼 笃麽",
    "簡單明瞭 简单明了",
    "籌畫 筹划",
    "素藉 素借",
    "耳沈 耳沉",
    "肉脩 肉脩",
    "肘手鍊足 肘手链足",
    "胤祕 胤祕",
    "脩敬 脩敬",
    "脩炳 脩炳",
    "脩脡 脩脡",
    "脩脯 脩脯",
    "脩金 脩金",
    "脫坏 脱坯",
    "腶脩 腶脩",
    "英哩 英里",
    "茅蒐 茅蒐",
    "茵藉 茵借",
    "萬鍾 万锺",
    "落雁沈魚 落雁沉鱼",
    "蒐于紅 蒐于红",
    "蒐於紅 蒐于红",
    "蒐狩 蒐狩",
    "蒐獮 蒐狝",
    "蒐獵 蒐猎",
    "蒐田 蒐田",
    "蒐畋 蒐畋",
    "蒐苗 蒐苗",
    "蒜薹 蒜薹",
    "蔣昇 蒋昇",
    "蕓薹 芸薹",
    "蕭乾 萧乾",
    "藉代 借代",
    "藉以 借以",
    "藉助 借助",
    "藉助於 借助于",
    "藉卉 借卉",
    "藉口 借口",
    "藉喻 借喻",
    "藉寇兵 借寇兵",
    "藉寇兵齎盜糧 借寇兵赍盗粮",
    "藉手 借手",
    "藉據 借据",
    "藉故 借故",
    "藉故推辭 借故推辞",
    "藉方 借方",
    "藉條 借条",
    "藉槁 借槁",
    "藉機 借机",
    "藉此 借此",
    "藉此機會 借此机会",
    "藉甚 借甚",
    "藉由 借由",
    "藉着 借着",
    "藉端 借端",
    "藉端生事 借端生事",
    "藉箸代籌 借箸代筹",
    "藉草枕塊 借草枕块",
    "藉詞 借词",
    "藉讀 借读",
    "藉資 借资",
    "衹得 只得",
    "衹見樹木 只见树木",
    "衹見樹木不見森林 只见树木不见森林",
    "袁祕 袁祕",
    "袖裏乾坤 袖里乾坤",
    "袷袢 袷袢",
    "製坏 制坯",
    "覆信 复信",
    "覆呈 复呈",
    "覆命 复命",
    "覆墓 复墓",
    "覆帳 复帐",
    "覆按 复按",
    "覆文 复文",
    "覆校 复校",
    "覆電 复电",
    "見覆 见复",
    "角徵 角徵",
    "角徵羽 角徵羽",
    "計畫 计划",
    "變徵 变徵",
    "變徵之聲 变徵之声",
    "變徵之音 变徵之音",
    "谿工 谿工",
    "赤石逕 赤石迳",
    "踅門瞭戶 踅门了户",
    "躪藉 躏借",
    "載沈載浮 载沉载浮",
    "載浮載沈 载浮载沉",
    "辛祕 辛祕",
    "逆釐 逆釐",
    "逕口 迳口",
    "逕聯 迳联",
    "逕頭 迳头",
    "郭子乾 郭子乾",
    "酒逢知己千鍾少 酒逢知己千锺少",
    "醞藉 酝借",
    "重覆 重复",
    "金吒 金吒",
    "金昇玟 金昇玟",
    "金鍊 金链",
    "鈞覆 钧复",
    "鉅子 钜子",
    "鉅萬 钜万",
    "鉅防 钜防",
    "鉸鍊 铰链",
    "銀鍊 银链",
    "鋼坏 钢坯",
    "錢鍾書 钱锺书",
    "鍊墜 链坠",
    "鍊子 链子",
    "鍊形 链形",
    "鍊條 链条",
    "鍊錘 链锤",
    "鍊鎖 链锁",
    "鍛鍾 锻锺",
    "鍾繇 锺繇",
    "鍾萬梅 锺万梅",
    "鍾重發 锺重发",
    "鍾鍛 锺锻",
    "鍾馗 锺馗",
    "鎖鍊 锁链",
    "鐵鍊 铁链",
    "鑽石項鍊 钻石项链",
    "鑿坏 凿坯",
    "閻鶴昇 阎鹤昇",
    "陰沈 阴沉",
    "陰沈沈 阴沉沉",
    "陰陰沈沈 阴阴沉沉",
    "陳志昇 陈志昇",
    "陳昇 陈昇",
    "陶坏 陶坯",
    "雁杳魚沈 雁杳鱼沉",
    "電覆 电复",
    "韓昇延 韩昇延",
    "項鍊 项链",
    "頸鍊 颈链",
    "顛乾倒坤 颠乾倒坤",
    "顛倒乾坤 颠倒乾坤",
    "顧藉 顾借",
    "魏徵 魏徵",
    "魚沈雁杳 鱼沉雁杳",
    "麪坏兒 面坯儿",
    "麼些族 麽些族",
    "黃鍾公 黄锺公",
    "黑沈沈 黑沉沉",
    "龔昇 龚昇",
  ];

  const HAN = /[\u3400-\u9fff]/;
  const HAN_ALL = /[\u3400-\u9fff]/g;
  const KANA = /[\u3040-\u30ff]/;
  // 常用繁体特征字。刻意不含 乾 / 著 / 藉 / 徵 / 祇 / 瞭 / 於 这类简体文本里也会
  // 出现的字，避免把简体歌词误判成繁体后改坏。
  const TRAD_HINT = /[這說們時為對來後裡國學愛聽聲讓誰覺邊過還開關點電話語詞寫讀書車馬鳥魚龍門問間陽陰雲風飛飯飲湯鹽醬麵髮鬆鬍鬥鐘錶週遊準製衝麼係個樣兒兩從會見現樂動嗎]/;

  let dict = null;

  function build() {
    if (dict) return dict;
    const characters = Object.create(null);
    for (let i = 0; i < TRAD.length; i += 1) characters[TRAD.charAt(i)] = SIMP.charAt(i);
    const byFirst = Object.create(null);
    for (let i = 0; i < PHRASES.length; i += 1) {
      const line = PHRASES[i];
      const at = line.indexOf(" ");
      const key = line.slice(0, at);
      const first = key.charAt(0);
      if (!byFirst[first]) byFirst[first] = [];
      byFirst[first].push([key, line.slice(at + 1)]);
    }
    // 长短语优先，否则「乾坤」会先于「乾坤大挪移」命中。
    for (const first in byFirst) byFirst[first].sort((a, b) => b[0].length - a[0].length);
    dict = { characters: characters, phrases: byFirst };
    return dict;
  }

  function isTraditional(value) {
    const text = Array.isArray(value) ? value.slice(0, 40).join("") : String(value || "");
    return !!text && TRAD_HINT.test(text) && !KANA.test(text);
  }

  function fold(value) {
    const text = String(value || "");
    if (!HAN.test(text)) return text;
    const table = build();
    let out = "";
    let i = 0;
    while (i < text.length) {
      const ch = text.charAt(i);
      const bucket = table.phrases[ch];
      let matched = null;
      if (bucket) {
        for (let j = 0; j < bucket.length; j += 1) {
          if (text.startsWith(bucket[j][0], i)) {
            matched = bucket[j][1];
            i += bucket[j][0].length;
            break;
          }
        }
      }
      if (matched !== null) {
        out += matched;
        continue;
      }
      out += table.characters[ch] || ch;
      i += 1;
    }
    return out;
  }

  // 只在判定为繁体时转换，简体 / 日文歌词原样返回。
  function toHans(value) {
    return isTraditional(value) ? fold(value) : String(value || "");
  }

  return { fold: fold, toHans: toHans, isTraditional: isTraditional };
})();

// Spotify Lyrics — 官方没有歌词时，用第三方歌词补上。
//
// 只处理 color-lyrics/v{N}/track/{id} 的响应：
//   200 且歌词非空  -> 清掉额度限制后原样放行（官方歌词质量更好）
//   404 / 空歌词    -> 取曲目元数据，按配置的歌词源查找，合成同结构响应
//
// spotify.js 补曲目 has_lyrics；feed 脚本在 scrollsita 缺少歌词 section 时补一格。
//
// 元数据：优先读 spotify.js 存下的客户端元数据（connect-state / context-resolve /
// metadata/4/track），命中时零外部请求；没命中才退回 open.spotify.com 的 oEmbed
// 与 embed 页面（公开接口，不需要 token）。
// 歌词源：LRCLIB / Musixmatch / 网易云 / QQ 音乐
//
// 客户端模式：Loon 传第 3 个参数 desktop=auto / ios / macos；auto 按 User-Agent
// 识别。没有 body 的 404 会优先按客户端请求的格式（JSON / protobuf）合成，
// 桌面端默认 JSON，iOS 无格式提示时默认 protobuf。
//
// 任何一步失败都原样放行，App 仍然显示它自己的「暂无歌词」，不会卡住播放。

(() => {
  "use strict";

  // feed 脚本以辅助模式加载：只暴露缓存查询与补卡判断，不处理响应。
  const HELPER = typeof SPOTIFY_LYRICS_HELPER !== "undefined" && SPOTIFY_LYRICS_HELPER;

  const req = typeof $request !== "undefined" && $request ? $request : null;
  const res = typeof $response !== "undefined" && $response ? $response : null;
  const url = (res && res.url) || (req && req.url) || "";

  // Loon 传位置数组，Egern 传 JSON 字符串。
  let opt = {};
  if (HELPER) {
    // feed 的位置参数和歌词脚本不同，由 feed/lyrics-card.js 解析后传入。
    opt = typeof SPOTIFY_HELPER_OPTIONS !== "undefined" && SPOTIFY_HELPER_OPTIONS ? SPOTIFY_HELPER_OPTIONS : {};
  } else {
    try {
      const raw = typeof $argument !== "undefined" ? $argument : undefined;
      if (Array.isArray(raw)) {
        // Loon 位置参数：歌词源, 补全歌词, 设备类型, 歌词字形, 忽略简繁。
        opt = {
          lyrics_source: raw[0],
          enable_lyrics: raw[1],
          desktop: raw[2],
          lyrics_script: raw[3],
          ignore_han_variants: raw[4],
        };
      }
      else if (typeof raw === "string") {
        try {
          opt = JSON.parse(raw || "{}") || {};
        } catch (e) {
          // Loon 单参数时可能直接传字符串
          opt = { lyrics_source: raw };
        }
      } else if (raw && "object" == typeof raw) opt = raw;
    } catch (e) {
      opt = {};
    }
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));
  // 客户端模式：auto 按 User-Agent 识别，拿不到 UA 时再看 Loon 运行环境。
  const requestUserAgent = () => {
    if (!req || !req.headers || "object" != typeof req.headers) return "";
    for (const key in req.headers) {
      if (String(key).toLowerCase() !== "user-agent") continue;
      const value = req.headers[key];
      return String(Array.isArray(value) ? value[0] || "" : value == null ? "" : value);
    }
    return "";
  };
  const detectDesktop = () => {
    const ua = requestUserAgent();
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return false;
    if (/Macintosh|Mac OS X|Darwin|Windows NT/i.test(ua)) return true;
    const loon = typeof $loon !== "undefined" ? String($loon) : "";
    return /^Mac\b/i.test(loon);
  };
  const desktopMode = (v) => {
    if (v === undefined || v === null || v === "") return detectDesktop();
    const mode = String(v).trim().toLowerCase();
    if (mode === "auto") return detectDesktop();
    if (mode === "macos" || mode === "mac" || mode === "desktop") return true;
    if (mode === "ios" || mode === "iphone" || mode === "ipad" || mode === "mobile") return false;
    return flag(v, false);
  };
  const desktop = desktopMode(opt.desktop);

  // 匹配用的繁→简折叠：Spotify 的中文曲名 / 歌手常是繁体，网易云 / QQ 曲库是
  // 简体；不折叠时「說謊」对不上「说谎」，「周杰倫」对不上「周杰伦」。
  const foldHanVariants = flag(opt.ignore_han_variants, true);
  // 补全歌词的显示字形：hans（默认）转简体，source 保持歌词源原文。
  // 只在整段判定为繁体时转换，简体 / 英文 / 日文歌词原样返回。
  const hansLyrics = (() => {
    const raw = opt.lyrics_script === undefined || opt.lyrics_script === null ? "hans" : opt.lyrics_script;
    const mode = String(raw).trim().toLowerCase();
    return mode !== "source" && mode !== "original" && mode !== "keep";
  })();

  // 参数关闭时直接放行；请求阶段的缓存命中在下面处理，未命中同样立即放行。
  // Loon 靠 enable= 决定是否加载脚本，Egern 不支持条件加载，只能在这里早退。
  if (!HELPER && !flag(opt.enable_lyrics, true)) {
    $done({});
    return;
  }

  const match = /\/color-lyrics\/v\d\/track\/([A-Za-z0-9]+)/.exec(url);
  let trackId = HELPER ? "" : match ? match[1] : "";
  if (!HELPER && !match) {
    $done({});
    return;
  }

  // LRCLIB 要求请求方在 UA 里说明自己是谁，所以默认保留这个描述性 UA。
  // 网易云 / QQ 音乐用的是网页接口，按接口形态换成浏览器 UA：
  // 非浏览器 UA 目前也能拿到数据，但更容易被风控或后续加白名单时挡掉。
  const USER_AGENT = "xzavier-modules/1.0 (https://github.com/xzavier-amico/modules)";
  const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  // search_for_qq_cp 是 QQ 音乐的移动端入口，配移动浏览器 UA 更一致。
  const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const utf8 = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  // spotify.js 在改写曲目元数据时，顺手把曲名 / 歌手 / 时长存进了本地存储。
  // 命中时连 oEmbed 都不用请求，只留 embed 页面取封面配色。
  const TRACK_CACHE_KEY = "spotify.track.meta.v2";
  const TRACK_CACHE_MAX = 24;

  // 歌词结果缓存：同一首歌的播放器、歌词页与歌词卡会重复请求 color-lyrics，
  // 命中后直接回缓存，不再打第三方源。命中的歌词基本不会变，存久一点；
  // 查不到 / 超时都不写缓存，避免一次网络抖动把这首歌判成「无歌词」。
  const LYRICS_CACHE_KEY = "spotify.lyrics.cache.v2";
  const LYRICS_CACHE_MAX = 24;
  const LYRICS_CACHE_HIT_TTL = 24 * 60 * 60 * 1000;
  const LYRICS_CACHE_MAX_LINES = 400;
  const LYRICS_CACHE_MAX_BYTES = 400 * 1024;
  // 4.5s 是「官方响应到达后」的预算：客户端大约 5s 就不再刷新 Now Playing，
  // 再等下去结果也显示不出来。只有真的在等第三方轮次时才会用满；所有源都
  // 快速返回「没有」时仍会立刻放行。
  const LYRICS_DEADLINE_MS = 4500;
  const PLAIN_FALLBACK_MS = 3500;
  // 元数据回源（open.spotify.com 的 oEmbed / embed 页面）单次上限。两个请求
  // 并行发出，超时不会让整条链路多等一轮；卡住不返回的请求最多拖 2.5 秒。
  const META_TIMEOUT_MS = 2500;
  // feed 在 scrollsita 里顺手回填曲名 / 歌手；首次进 Now Playing 时它可能比
  // 歌词脚本晚一点点。100ms 看一次缓存，最多 2s；命中后立刻开始查歌词，
  // 不用等 open.spotify.com 的 oEmbed。定时器只是优化：没命中时仍按原来的
  // oEmbed / embed 流程走，不会多等。
  const META_WAIT_MS = 2000;
  const META_POLL_MS = 100;

  // 确认没有歌词的曲目，短期内不再补空卡。
  const MISS_KEY = "spotify.lyrics.miss";
  const MISS_TTL_MS = 5 * 60 * 1000;

  // 歌词请求进度：请求阶段写 pending。feed 补卡时据此判断「这首歌的歌词正在查」，
  // 有请求在路上时旧的 miss 标记不作数，避免把这次可能成功的歌词挡掉。
  const PENDING_KEY = "spotify.lyrics.pending";
  // 歌词脚本自己的 deadline 是 4.5s；超过 10s 还没清掉就是脚本被杀了，按失效处理。
  const PENDING_TTL_MS = 10 * 1000;

  const storeBackend = () =>
    typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;

  function readJsonMap(key) {
    const store = storeBackend();
    if (!store) return null;
    try {
      const raw = store.read(key);
      const map = raw ? JSON.parse(raw) : null;
      return map && "object" == typeof map && !Array.isArray(map) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function writeJsonMap(key, map) {
    const store = storeBackend();
    if (!store) return;
    try {
      store.write(JSON.stringify(map), key);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  // 请求标记：不同脚本实例（歌词 / connect-state / feed）之间只靠持久化存储
  // 通信，标记一律带时间戳，脚本被超时杀掉时也不会长期阻塞后续调度。
  function readMark(key) {
    const store = storeBackend();
    if (!store) return null;
    try {
      const raw = store.read(key);
      const value = raw ? JSON.parse(raw) : null;
      return value && "object" == typeof value ? value : null;
    } catch (e) {
      return null;
    }
  }

  function writeMark(key, value) {
    const store = storeBackend();
    if (!store) return;
    try {
      store.write(value ? JSON.stringify(value) : "", key);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  function activeMark(key, id, ttl) {
    const mark = readMark(key);
    return mark && (!id || mark.id === id) && Number(mark.at) && Date.now() - Number(mark.at) < ttl ? mark : null;
  }

  // 歌词请求已经开始（请求阶段放行官方请求之前），feed 据此判断这首歌是否
  // 正在查询，避免旧的 miss 标记把这次可能成功的歌词挡掉。
  const markPending = () => {
    if (trackId) writeMark(PENDING_KEY, { id: trackId, at: Date.now() });
  };

  function cachedTrackMeta(id) {
    const map = readJsonMap(TRACK_CACHE_KEY);
    const value = map && map[id];
    if (!value || !value[0]) return null;
    const ms = Number(value[2]);
    const color = value[4];
    return {
      title: String(value[0]),
      artist: String(value[1] || "").trim(),
      duration: Number.isFinite(ms) && ms > 10000 ? ms / 1000 : undefined,
      color: color && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g)) && Number.isFinite(Number(color.b))
        ? { r: Number(color.r), g: Number(color.g), b: Number(color.b) }
        : null,
    };
  }

  // 从 oEmbed / embed 拿到的元数据也写回同一份缓存：下次播放直接命中，
  // 连 open.spotify.com 都不用请求。顺便缓存封面色，歌词页背景保持一致。
  function rememberTrackMeta(id, title, artist, durationMs, color) {
    if (!id || !title) return;
    const map = readJsonMap(TRACK_CACHE_KEY) || {};
    const next = [String(title), String(artist || ""), Number(durationMs) || 0, Date.now()];
    if (color && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g)) && Number.isFinite(Number(color.b))) {
      next[4] = { r: Number(color.r), g: Number(color.g), b: Number(color.b) };
    }
    const old = map[id];
    if (
      old &&
      old[0] === next[0] &&
      old[1] === next[1] &&
      Number(old[2]) === next[2] &&
      (!next[4] || (old[4] && old[4].r === next[4].r && old[4].g === next[4].g && old[4].b === next[4].b))
    ) return;
    map[id] = next;
    const ids = Object.keys(map).sort((a, b) => Number(map[b][3] || 0) - Number(map[a][3] || 0));
    for (const key of ids.slice(TRACK_CACHE_MAX)) delete map[key];
    writeJsonMap(TRACK_CACHE_KEY, map);
  }

  function lyricsSourceKey() {
    const wanted = String(opt.lyrics_source || "auto").toLowerCase();
    return wanted === "lrclib" || wanted === "musixmatch" || wanted === "netease" || wanted === "qq" ? wanted : "auto";
  }

  const lyricsCacheKey = (id) => lyricsSourceKey() + "|" + (hansLyrics ? "hans" : "source") + "|" + id;

  function readLyricsCache(key, id) {
    const map = readJsonMap(LYRICS_CACHE_KEY);
    const valid = (value) => !!value && "object" == typeof value && !value.m &&
      Date.now() - Number(value.t || 0) < LYRICS_CACHE_HIT_TTL &&
      // 缓存存的是已经转换过的歌词；字形设置换过就不复用，避免显示成另一种字形。
      (HELPER || (Number(value.z) || 0) === (hansLyrics ? 1 : 0));
    let entry = map && map[key];
    // 配置换过歌词源（auto ↔ lrclib）时旧缓存 key 会不同；按曲目 id 再找一次，
    // 避免同一首歌已经缓存过却因为前缀不同重新查源。
    if (!valid(entry) && id) {
      const suffix = "|" + id;
      for (const name of Object.keys(map || {})) {
        if (name.slice(-suffix.length) !== suffix) continue;
        const candidate = map[name];
        if (valid(candidate)) {
          entry = candidate;
          break;
        }
      }
    }
    if (!valid(entry)) return null;
    const lines = Array.isArray(entry.a) ? entry.a : [];
    if (!lines.length) return null;
    const signed = (value) => (value > 0x7fffffff ? value - 0x100000000 : value);
    const provider = String(entry.p || "LRCLIB");
    return {
      payload: {
        lyrics: {
          syncType: entry.s === "UNSYNCED" ? "UNSYNCED" : "LINE_SYNCED",
          lines: lines.map((pair) => ({
            startTimeMs: String(Number(pair && pair[0]) || 0),
            words: String((pair && pair[1]) || ""),
            syllables: [],
            endTimeMs: "0",
          })),
          provider: provider,
          providerLyricsId: entry.i === undefined || entry.i === null ? "" : String(entry.i),
          providerDisplayName: provider,
          syncLyricsUri: "",
          isDenseTypeface: false,
          alternatives: [],
          language: String(entry.l || "en"),
          isRtlLanguage: false,
          fullscreenAction: "FULLSCREEN_LYRICS",
        },
        colors: {
          background: signed(Number(entry.c && entry.c[0]) || 0xff808080),
          text: signed(Number(entry.c && entry.c[1]) || 0xff000000),
          highlightText: signed(Number(entry.c && entry.c[2]) || 0xffffffff),
        },
        hasVocalRemoval: false,
      },
    };
  }

  function writeLyricsCache(key, payload) {
    // 只缓存真正拿到的歌词；查不到 / 超时都不写，下一次打开可以立刻重试。
    if (!payload) return;
    const map = readJsonMap(LYRICS_CACHE_KEY) || {};
    const now = Date.now();
    const lyrics = payload.lyrics || {};
    const colors = payload.colors || {};
    const lines = [];
    const raw = Array.isArray(lyrics.lines) ? lyrics.lines : [];
    for (let i = 0; i < raw.length && i < LYRICS_CACHE_MAX_LINES; i += 1) {
      const line = raw[i];
      if (!line || typeof line.words !== "string" || !line.words.trim()) continue;
      lines.push([Number(line.startTimeMs) || 0, line.words.slice(0, 200)]);
    }
    if (!lines.length) return;
    map[key] = {
      t: now,
      m: 0,
      z: hansLyrics ? 1 : 0,
      s: lyrics.syncType === "UNSYNCED" ? "UNSYNCED" : "LINE_SYNCED",
      p: String(lyrics.provider || "LRCLIB"),
      i: lyrics.providerLyricsId === undefined || lyrics.providerLyricsId === null ? "" : String(lyrics.providerLyricsId),
      l: String(lyrics.language || "en"),
      c: [Number(colors.background) || 0xff808080, Number(colors.text) || 0xff000000, Number(colors.highlightText) || 0xffffffff],
      a: lines,
    };
    for (const id of Object.keys(map)) {
      const entry = map[id];
      // 清掉过期条目和 miss 记录。
      if (!entry || entry.m || !(now - Number(entry.t || 0) < LYRICS_CACHE_HIT_TTL)) delete map[id];
    }
    const byAge = () => Object.keys(map).sort((a, b) => Number(map[b].t || 0) - Number(map[a].t || 0));
    for (const id of byAge().slice(LYRICS_CACHE_MAX)) delete map[id];

    // 存储空间和解析成本都要控住：整包超过上限时继续按时间淘汰最旧的。
    const store = storeBackend();
    if (!store) return;
    try {
      let json = JSON.stringify(map);
      for (const id of byAge()) {
        if (json.length <= LYRICS_CACHE_MAX_BYTES || Object.keys(map).length <= 1) break;
        delete map[id];
        json = JSON.stringify(map);
      }
      store.write(json, LYRICS_CACHE_KEY);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  // 歌词页配色在 albumColors() 里按官方规则计算：封面主色做背景，未激活行黑色，
  // 当前 / 已唱行白色。三项都是 alpha=0xFF 的不透明色，不能依赖 alpha 区分。
  // 官方 previewLines 给 5 行；超过歌词总行数时按实际行数截断。
  const PREVIEW_LINES = 5;

  // 这些正则会在逐行解析里反复用到，提到外层只创建一次。
  const LRC_STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const LRC_OFFSET = /^\[offset:\s*(-?\d+)\s*\]$/i;
  const LRC_BRACKET = /\[[^\]]*\]/g;
  const NORMALIZE_DROP = /[^\p{L}\p{M}\p{N}]+/gu;
  const LIVE_MARK = /(?:\blive\b|live版|现场|現場|[一二三四五六七八九十\d]+公)/i;
  const STAGE_MARK = /([一二三四五六七八九十\d]+公)/;
  const INSTRUMENTAL_MARK = /伴奏|instrumental|karaoke/i;
  const SONG_TITLE_LIVE = /\s*[-–—]\s*[^-–—]*(?:\blive\b|live版|现场|現場).*$/i;
  const SONG_TITLE_LIVE_BRACKET = /[（(][^()（）]*(?:live|现场|現場)[^()（）]*[)）]/gi;
  const SONG_TITLE_BRACKET_GROUP = /[（(]([^()（）]*)[)）]/g;
  // 括号里带这些词时说明是不同版本（Live / Remix / 伴奏…），不能当装饰信息删掉。
  const SONG_TITLE_VERSION_BRACKET = /\b(?:live|acoustic|unplugged|remix|mix|version|edit|remaster(?:ed)?|instrumental|karaoke|demo|cover|session|mono|stereo|deluxe|bonus|explicit|clean)\b|现场|現場|演唱会|演唱會|伴奏|纯音乐|純音樂|混音|重制|重製|翻唱|翻自|试听|試聽|片段|版/i;
  const SONG_TITLE_BRACKET_NOISE = /[（(\[][^()（）\[\]]*\b(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|feat\.?|ft\.?|featuring|with|prod\.?|radio edit|single version|album version|bonus track|deluxe(?: edition)?|explicit|clean|mono|stereo)\b[^()（）\[\]]*[)）\]]/gi;
  const SONG_TITLE_DASH_FEAT = /\s*[-–—]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?)\b.*$/i;
  const SONG_TITLE_DASH_EDITION = /\s*[-–—]\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|radio edit|single version|album version|bonus track|deluxe(?: edition)?|explicit|clean|mono|stereo)\s*$/i;
  // DJ 版本：DJ版 / DJ Remix / DJ Mix / (DJ) / 末尾 - DJ。只认这些版本写法，
  // 避免把 "DJ Got Us Fallin' In Love" 这类曲名当成 DJ 版本。
  const DJ_VERSION_MARK = /dj\s*(?:版|remix|mix|version|edit|抖音|舞曲|慢摇|house|club)|[（(\[]\s*dj\s*[)）\]]|(?:^|[\s\-–—])dj\s*$/i;
  const SONG_TITLE_DASH_DJ = /\s*[-–—]\s*dj\s*(?:版|remix|mix|version|edit|抖音|舞曲|慢摇|house|club).*$|\s*[-–—]\s*dj\s*$/i;
  const SONG_TITLE_LEADING_DJ = /^\s*dj\s*(?:版|remix|mix|version|edit|抖音|舞曲|慢摇|house|club)\s*[-–—:]?\s*/i;
  const ARTIST_SPLIT = /[,，、/;&]|\b(?:feat\.?|ft\.?|featuring|with)\b/i;
  const CJK_MARK = /[\u3400-\u9fff]/;
  const KANA_MARK = /[\u3040-\u30ff]/;
  const HANGUL_MARK = /[\uac00-\ud7af]/;
  const HAN_MARK = /[\u4e00-\u9fff]/;

  // 响应体上限：官方歌词正常 < 300 KiB，第三方 JSON 也远小于 2 MiB。
  // 超过上限直接放行 / 当作没查到，避免异常响应把脚本内存打爆。
  const MAX_LYRICS_BYTES = 2 * 1024 * 1024;
  const MAX_HTTP_JSON_BYTES = 2 * 1024 * 1024;

  let settled = false;
  let deadline;
  let plainTimer;
  let plainFallback = null;
  let cacheKey = "";
  const finish = (value) => {
    if (settled) return;
    settled = true;
    if (deadline !== undefined && typeof clearTimeout === "function") clearTimeout(deadline);
    if (plainTimer !== undefined && typeof clearTimeout === "function") clearTimeout(plainTimer);
    // 请求阶段没有 $response：Loon / Egern / Shadowrocket 用 { response } 直接
    // 返回合成结果，跳过官方 color-lyrics 请求。
    if (!res) {
      $done(value && (value.status || value.body) ? { response: value } : {});
      return;
    }
    // 响应已经交给客户端，这次歌词请求不会再产出结果；清掉 pending，
    // 让 feed 不用一直按「还在查」延长等待（超时后晚到的结果仍会写缓存）。
    writeMark(PENDING_KEY, null);
    $done(value);
  };

  if (HELPER) {
    // 辅助模式：feed 脚本只复用缓存查询与补卡判断，不发起歌词查询。
    // 曲目元数据回填：feed 从 scrollsita 里抄到的曲名 / 歌手写进同一份缓存。
    globalThis.__spotifyRememberTrackMeta = rememberTrackMeta;

    // 最近确认没有歌词的曲目不再补空卡；已经查到歌词、或有歌词请求在路上时
    // 以实际进度为准，避免旧的 miss 标记把这次可能成功的歌词挡掉。
    globalThis.__spotifyLyricsCard = (id) => {
      if (!id || !flag(opt.enable_lyrics, true)) return false;
      if (readLyricsCache(lyricsCacheKey(id), id)) return true;
      if (activeMark(PENDING_KEY, id, PENDING_TTL_MS)) return true;
      if (activeMark(MISS_KEY, id, MISS_TTL_MS)) return false;
      return true;
    };
    return;
  }

  // 请求阶段：缓存命中直接返回合成歌词，跳过官方请求；未命中立即放行。
  if (!res) {
    if (!HELPER && trackId && flag(opt.enable_lyrics, true)) {
      cacheKey = lyricsCacheKey(trackId);
      const cached = readLyricsCache(cacheKey, trackId);
      const proto = requestedProtoMode();
      if (cached) {
        writeMark(MISS_KEY, null);
        writeMark(PENDING_KEY, null);
        if (proto) {
          const bytes = encodeProto(cached.payload.lyrics.lines, cached.payload.lyrics.syncType,
            cached.payload.lyrics.provider, cached.payload.lyrics.providerLyricsId,
            cached.payload.lyrics.language, cached.payload.colors);
          finish({
            status: 200,
            headers: { "Content-Type": "application/vnd.google.protobuf" },
            body: bytes,
          });
        } else {
          const body = JSON.stringify(cached.payload);
          finish({
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: body,
          });
        }
        return;
      }
    }
    // 未命中：官方请求还要飞一会儿，先标 pending，feed 据此判断歌词正在查。
    markPending();
    finish({});
    return;
  }

  const rawBody = res.body;
  const rawBytes = toBytes(rawBody);
  const rawLength = "string" == typeof rawBody ? rawBody.length : rawBytes.length;
  if (rawLength > MAX_LYRICS_BYTES) {
    // 超大的官方响应不解析，原样放行；超大 404 也当作没有歌词。
    finish({});
    return;
  }

  // protobuf 不先转 UTF-8：只检查第一个非空白字节来区分 JSON。
  let start = 0;
  while (start < rawBytes.length && (rawBytes[start] === 32 || rawBytes[start] === 9 || rawBytes[start] === 10 || rawBytes[start] === 13)) start++;
  const trimmed = typeof rawBody === "string" ? rawBody.trim() : rawBytes[start] === 123 ? toText(rawBytes).trim() : "";
  const hasBody = typeof rawBody === "string" ? trimmed.length > 0 : rawBytes.length > 0;
  const status = Number(res.status || res.statusCode);

  function headerValue(headers, name) {
    if (!headers || "object" != typeof headers) return "";
    for (const key in headers) {
      if (String(key).toLowerCase() !== name) continue;
      const value = headers[key];
      if (Array.isArray(value)) return String(value[0] || "");
      return String(value === undefined || value === null ? "" : value);
    }
    return "";
  }

  // 404 的 body 和 Content-Type 都描述错误，不能用来推断歌词响应格式。
  // 补全时遵循请求的 format / Accept；没有提示则用客户端默认格式。
  function requestedProtoMode() {
    const accept = headerValue(req && req.headers, "accept").toLowerCase();
    const format = /[?&]format=(json|protobuf)(?:&|$)/i.exec(url);
    const requested = format ? format[1].toLowerCase() === "protobuf"
      : accept.indexOf("protobuf") >= 0 ? true
      : accept.indexOf("json") >= 0 ? false
      : null;
    return requested !== null ? requested : !desktop;
  }
  const protoMode = status === 200 && hasBody
    ? trimmed.charAt(0) !== "{"
    : requestedProtoMode();

  // 不把登录、限流或服务端错误伪装成有歌词。
  if (status !== 200 && status !== 404) {
    finish({});
    return;
  }

  // 官方「没有歌词」不一定回 404：protobuf 请求经常是 200 + 空体。
  // 空体有两种情况，必须区分开：
  //   * 上游确实没内容（content-length 缺失或 0）-> 当作没有歌词，去第三方补；
  //   * body 没交到脚本手里（content-length > 0）-> 原样放行，不能把官方歌词顶掉。
  if (status === 200 && !hasBody) {
    const declared = Number(headerValue(res && res.headers, "content-length"));
    if (Number.isFinite(declared) && declared > 0) {
      finish({});
      return;
    }
  } else if (status === 200) {
    if (protoMode) {
      // 解析不了（拿不到原始字节）时返回 -1，宁可放行也不要顶掉官方歌词。
      const inspected = rawBytes.length ? inspectProto(rawBytes) : null;
      const count = inspected ? inspected.count : -1;
      if (count !== 0) {
        // 免费号的歌词有每月额度，用完服务端会在 restriction（字段 14）里回
        // monthlyLimitReached，客户端就只显示「额度已用完」。归一成 showLyrics 再放行。
        const cleaned = count > 0 ? normalizeRestrictionProto(inspected) : null;
        if (cleaned) {
          finish({ status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: cleaned });
        } else {
          // 原样放行，但 count > 0 说明官方歌词确实有内容。
          finish({});
        }
        return;
      }
    } else if (hasLyrics(trimmed)) {
      const cleaned = stripRestrictionJson(trimmed);
      if (cleaned) {
        finish({ status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: cleaned });
      } else {
        finish({});
      }
      return;
    }
  }

  // 歌词结果缓存：同一首歌在播放器 / 歌词页 / 歌词卡之间的重复请求不再重复查源。
  // 只缓存「官方没有歌词」的分支，官方歌词不会走到这里。
  cacheKey = lyricsCacheKey(trackId);
  const cachedLyrics = readLyricsCache(cacheKey, trackId);
  if (cachedLyrics) {
    writeMark(MISS_KEY, null);
    emit(cachedLyrics.payload);
    return;
  }

  // 总时限；超时后用纯文本兜底，没有就放行。超时不写 miss 标记：第三方歌词
  // 可能还在路上，后续到达的歌词会写进缓存，用户重新进歌词页时请求阶段直接命中。
  // 只有所有第三方源都确认没歌词时才写 miss。
  if (typeof setTimeout === "function") deadline = setTimeout(() => {
    if (settled) return;
    if (plainFallback) {
      writeLyricsCache(cacheKey, plainFallback);
      writeMark(MISS_KEY, null);
      emit(plainFallback);
    } else {
      finish({});
    }
  }, LYRICS_DEADLINE_MS);
  resolveLyrics((payload) => {
    if (settled) {
      // deadline 超时放行后，所有源都确认没歌词时补写 miss 标记；feed 补卡时
      // 读到 miss 就不再乐观补空卡。拿到了歌词则由 runSource 写缓存。
      if (!payload) writeMark(MISS_KEY, { id: trackId, at: Date.now() });
      return;
    }
    writeLyricsCache(cacheKey, payload);
    if (!payload) {
      writeMark(MISS_KEY, { id: trackId, at: Date.now() });
      finish({});
      return;
    }
    writeMark(MISS_KEY, null);
    emit(payload);
  });

  // 取曲目元数据 -> 按配置的歌词源找 -> 回调 payload
  function resolveLyrics(cb) {
    resolvePublicLyrics(cb);
  }

  function resolvePublicLyrics(cb) {
    // 客户端拉过的元数据优先：命中时直接查歌词，open.spotify.com 一次都不请求，
    // 歌词页背景用默认底色（不再为封面配色抓 embed 页面）。
    const startWith = (info, colorOf) => {
      runSource(sourceOrder(info.title, info.artist), info.title, info.artist, cb, info.duration, colorOf);
    };
    const cached = cachedTrackMeta(trackId);
    if (cached) {
      startWith(cached, () => cached.color || null);
      return;
    }
    const oembedUrl = "https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/" + trackId);
    const embedUrl = "https://open.spotify.com/embed/track/" + trackId;
    let meta = null;
    let embed = null;
    let metaDone = false;
    let embedStarted = false;
    let embedDone = false;
    let started = false;
    const merged = () => {
      const oembed = {
        title: String((meta && meta.title) || ""),
        artist: String((meta && meta.author_name) || "").trim(),
      };
      const page = embed || {};
      // 缺歌手或 Live 曲目时以 embed 的写法 / 时长为准，其余优先 oEmbed。
      const preferEmbed = !oembed.title || !oembed.artist || isLive(oembed.title);
      return {
        title: String((preferEmbed ? page.title : oembed.title) || oembed.title || page.title || ""),
        artist: String((preferEmbed ? page.artist : oembed.artist) || oembed.artist || page.artist || "").trim(),
        duration: page.duration,
      };
    };
    const colorOf = () => (embed && embed.color) || null;
    const start = () => {
      if (started) return;
      const info = merged();
      if (!info.title) {
        started = true;
        cb(null);
        return;
      }
      started = true;
      rememberTrackMeta(trackId, info.title, info.artist, info.duration ? info.duration * 1000 : 0, colorOf());
      startWith({ title: info.title, artist: info.artist, duration: info.duration }, colorOf);
    };
    // embed 提供封面主色与兜底元数据；与 oEmbed 并行发出，谁先到用谁。
    const beginEmbed = () => {
      if (embedStarted) return;
      embedStarted = true;
      httpGetText(embedUrl, (html) => {
        embed = parseEmbedTrack(html);
        embedDone = true;
        // 歌词可能已经先返回了；embed 晚到时只补一份封面配色与更准确的元数据。
        if (started && embed && embed.color) {
          const info = merged();
          rememberTrackMeta(trackId, info.title, info.artist, info.duration ? info.duration * 1000 : 0, embed.color);
        }
        maybeStart();
      }, null, META_TIMEOUT_MS);
    };
    const maybeStart = () => {
      if (started) return;
      const info = merged();
      if (!metaDone) return;
      if (!info.title) {
        // oEmbed 没给曲名时靠 embed 补；embed 也失败才放弃。
        if (!embedDone) {
          beginEmbed();
          return;
        }
        start();
        return;
      }
      // 缺歌手、Live 或 DJ 版本要靠 embed 的歌手 / 时长做校验，才等 embed。
      if ((!info.artist || isLive(info.title) || isDj(info.title)) && !embedDone) {
        beginEmbed();
        return;
      }
      // 正常曲目立即开始查歌词，同时发出配色请求，但不等待它。
      beginEmbed();
      start();
    };
    // 两个来源并行：oEmbed 有曲名 / 歌手，embed 有封面色和更规范的写法。
    beginEmbed();
    httpGetJson(oembedUrl, (data) => {
      meta = data;
      metaDone = true;
      maybeStart();
    }, null, META_TIMEOUT_MS);
    // feed 回填的元数据可能比 oEmbed 先就绪：100ms 看一次缓存，最多 2s。
    // 命中就直接开始查歌词，oEmbed / embed 晚到只补封面配色；没命中则保持原流程。
    if (storeBackend() && typeof setTimeout === "function") {
      let waited = 0;
      const poll = () => {
        setTimeout(() => {
          if (started || settled) return;
          const hit = cachedTrackMeta(trackId);
          if (hit) {
            started = true;
            startWith(hit, () => (embed && embed.color) || hit.color || null);
            return;
          }
          waited += META_POLL_MS;
          if (waited < META_WAIT_MS) poll();
        }, META_POLL_MS);
      };
      poll();
    }
  }

  // ---- 歌词源 -----------------------------------------------------------

  function sourceOrder(title, artist) {
    const wanted = String(opt.lyrics_source || "auto").toLowerCase();
    // Musixmatch 是 Spotify 的官方歌词上游，auto 不使用，仅在显式选择时查询。
    const auto = CJK_MARK.test(title + artist)
      ? ["netease", "qq", "lrclib"] : ["lrclib", "netease", "qq"];
    if (wanted === "lrclib" || wanted === "musixmatch" || wanted === "netease" || wanted === "qq") return [wanted];
    return auto;
  }

  // 并发查询所有来源：首个通过校验的同步歌词胜出；只有纯文本时等全部结束。
  // settled 后不再 emit（响应已放行），但仍然写缓存：用户重新进歌词页时
  // 请求阶段就能直接命中。全部源都确认没歌词时才写 miss 标记。
  function runSource(order, title, artist, done, duration, colorOf) {
    if (settled) return;
    if (!order.length) {
      done(null);
      return;
    }
    let remaining = order.length;
    let finished = false;
    const checkAllDone = () => {
      if (!remaining && !finished) {
        finished = true;
        done(plainFallback);
      }
    };
    for (const name of order) {
      if (settled || finished) return;
      lookup(name, title, artist, duration, (record) => {
        if (settled) {
          // deadline 超时放行：歌词晚到时写缓存，下次请求阶段直接命中。
          if (record && colorOf) record.albumColor = colorOf();
          const latePayload = buildPayload(record);
          if (latePayload) writeLyricsCache(cacheKey, latePayload);
          remaining -= 1;
          checkAllDone();
          return;
        }
        if (finished) return;
        if (record && colorOf) record.albumColor = colorOf();
        const payload = buildPayload(record);
        if (payload && (payload.lyrics.syncType === "LINE_SYNCED" || order.length === 1)) {
          finished = true;
          done(payload);
          return;
        }
        if (payload && !plainFallback) {
          plainFallback = payload;
          // 有纯文本但同步歌词还在路上时，先把纯文本发出去，后续结果不再覆盖。
          // deadline 超时放行后仍然写缓存，供下次请求命中。
          if (typeof setTimeout === "function") plainTimer = setTimeout(() => {
            if (!plainFallback) return;
            writeLyricsCache(cacheKey, plainFallback);
            if (!settled) emit(plainFallback);
          }, PLAIN_FALLBACK_MS);
        }
        remaining -= 1;
        checkAllDone();
      });
    }
  }

  function lookup(name, title, artist, duration, cb) {
    if (name === "lrclib") return lookupLrclib(title, artist, duration, cb);
    if (name === "netease") return lookupNetease(title, artist, duration, cb);
    if (name === "qq") return lookupQq(title, artist, duration, cb);
    if (name === "musixmatch") return lookupMusixmatch(title, artist, duration, cb);
    cb(null);
  }

  // LRCLIB：/api/get 与 /api/search 都会带回歌词。完整曲名、去掉装饰括号后的
  // 曲名、以及繁→简折叠后的写法，各发 get + search；歌名-only 的搜索也放进
  // 同一批。全部并行，首个通过校验的同步歌词立即返回——不再有串行的兜底轮次。
  function lookupLrclib(title, artist, duration, cb) {
    const cleanTitle = queryTitle(title);
    // DJ 版本常换制作人署名，查询时不带歌手；pickRecord 仍会拿 artist 做打分。
    const queryArtist = isDj(title) ? "" : artist;
    const fold = (value) => (foldHanVariants && typeof SPOTIFY_HAN_VARIANTS !== "undefined"
      ? SPOTIFY_HAN_VARIANTS.fold(String(value || ""))
      : String(value || ""));

    // 每个曲名配对应的歌手写法；繁简折叠后的曲名配折叠后的歌手。
    const variants = [];
    const addVariant = (name, singer) => {
      const text = String(name || "").trim();
      if (!text) return;
      const key = text + "\n" + String(singer || "");
      if (variants.some((item) => item.key === key)) return;
      variants.push({ key: key, name: text, artist: String(singer || "") });
    };
    addVariant(title, queryArtist);
    addVariant(cleanTitle, queryArtist);
    if (foldHanVariants && typeof SPOTIFY_HAN_VARIANTS !== "undefined") {
      const foldedArtist = fold(queryArtist);
      addVariant(fold(title), foldedArtist);
      addVariant(fold(cleanTitle), foldedArtist);
    }

    const lists = [];
    const records = [];
    let done = false;
    const all = () => lists.concat(records);
    const syncedPick = () => {
      const synced = [];
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const item of list) if (isSynced(item)) synced.push(item);
      }
      for (const record of records) if (isSynced(record)) synced.push(record);
      return pickRecord(synced, title, duration, artist);
    };

    // 先把所有请求列出来再统一发出：同步回调不会在批次中途把 pending 减到 0，
    // pending 减到 0，避免提前判定「都没命中」。
    const specs = [];
    const addSpec = (path, name, singer) => {
      const query = "track_name=" + encodeURIComponent(name) + (singer ? "&artist_name=" + encodeURIComponent(singer) : "");
      const url = "https://lrclib.net/api/" + path + "?" + query;
      if (specs.some((item) => item.url === url)) return;
      specs.push({ url: url, path: path });
    };
    for (const item of variants) {
      addSpec("get", item.name, item.artist);
      addSpec("search", item.name, item.artist);
    }
    // 歌手写法不一致（feat. / 多歌手 / 翻译名）时的兜底也并进首轮。
    addSpec("search", cleanTitle || title, "");
    const foldedName = fold(cleanTitle || title);
    if (foldedName !== (cleanTitle || title)) addSpec("search", foldedName, "");
    if (!specs.length) {
      cb(null);
      return;
    }
    let pending = specs.length;

    const settle = () => {
      pending -= 1;
      if (done) return;
      const hit = syncedPick();
      if (hit) {
        done = true;
        cb(withProvider(hit, "LRCLIB"));
        return;
      }
      if (pending) return;
      done = true;
      const picked = pickRecord(all(), title, duration, artist);
      cb(picked ? withProvider(picked, "LRCLIB") : null);
    };

    for (const spec of specs) {
      httpGetJson(spec.url, (data) => {
        if (spec.path === "get") {
          if (data && "object" === typeof data) records.push(data);
        } else if (Array.isArray(data)) {
          lists.push(data);
        }
        settle();
      });
    }
  }

  // 网易云：搜索接口不需要 token，中文曲库覆盖最好。
  function lookupNetease(title, artist, duration, cb) {
    const queryArtist = isDj(title) ? "" : artist;
    const query = encodeURIComponent(queryTitle(title) + (queryArtist ? " " + queryArtist : ""));
    const headers = { Referer: "https://music.163.com/", "User-Agent": BROWSER_UA };
    const artistOf = (item) => (item.artists || []).reduce((names, a) => names.concat(artistNames(a)), []);
    const durationOf = (item) => Number(item.duration) / 1000;
    httpGetJson("https://music.163.com/api/search/get?s=" + query + "&type=1&limit=10&offset=0", (data) => {
      const songs = data && data.result && data.result.songs;
      // 同一首歌的歌词只取一次：alias 补全期间的预取和正式候选会并行，
      // 后到的调用合并到在途请求上，不重复打接口。
      const lyrics = Object.create(null);
      const waiting = Object.create(null);
      const fetchLyric = (song, next) => {
        const id = String(song.id);
        if (lyrics[id] !== undefined) {
          next(lyrics[id]);
          return;
        }
        if (waiting[id]) {
          waiting[id].push(next);
          return;
        }
        waiting[id] = [next];
        httpGetJson("https://music.163.com/api/song/lyric?id=" + id + "&lv=-1&kv=-1&tv=-1", (lyric) => {
          const text = lyric && lyric.lrc && lyric.lrc.lyric;
          const record = text ? { provider: "NetEase", providerId: id, syncedLyrics: text } : null;
          lyrics[id] = record;
          const callbacks = waiting[id] || [];
          delete waiting[id];
          for (const fn of callbacks) fn(record);
        }, headers);
      };
      const ranked = rankSongs(songs, title, artist, duration, (item) => item.name, artistOf, durationOf);
      if (ranked.length) {
        tryCandidates(ranked, fetchLyric, cb);
        return;
      }
      // 搜索结果可能缺少歌手别名：只对匹配的曲目按歌手 ID 补全，最多 3 次请求。
      const pending = [];
      if (artist && Array.isArray(songs)) {
        const speculative = [];
        for (const song of songs) {
          if (!song || !matchesSong(title, "", duration, song.name, "", durationOf(song))) continue;
          const people = Array.isArray(song.artists) ? song.artists : [];
          if (matchesArtist(artist, artistOf(song))) continue;
          // 歌名 / 时长已对上、只差歌手写法：先把歌词取回来，alias 确认后直接复用。
          if (speculative.length < 2) speculative.push(song);
          for (const person of people) {
            if (!person || !/^\d+$/.test(String(person.id)) || pending.some((p) => p.id === person.id)) continue;
            if (pending.length < 3) pending.push(person);
          }
        }
        // 预取与歌手详情并行发出；晚到的结果由 fetchLyric 合并。
        for (const song of speculative) fetchLyric(song, () => {});
      }
      const resolve = () => {
        if (!pending.length) {
          tryCandidates(rankSongs(songs, title, artist, duration, (item) => item.name, artistOf, durationOf), fetchLyric, cb);
          return;
        }
        // 歌手详情请求并行发出，全部回来后再统一补 alias。
        let left = pending.length;
        for (const person of pending) {
          httpGetJson("https://music.163.com/api/artist/" + person.id, (details) => {
            const verified = details && details.artist;
            if (verified && String(verified.id) === String(person.id) && Array.isArray(songs)) {
              for (const song of songs) {
                for (const candidate of (song && Array.isArray(song.artists) ? song.artists : [])) {
                  if (candidate && candidate.id === person.id) candidate.alias = artistNames(candidate).concat(artistNames(verified));
                }
              }
            }
            left -= 1;
            if (!left) {
              tryCandidates(rankSongs(songs, title, artist, duration, (item) => item.name, artistOf, durationOf), fetchLyric, cb);
            }
          }, headers);
        }
      };
      resolve();
    }, headers);
  }

  // QQ 音乐：搜索拿 songmid，再用 nobase64=1 取明文 LRC。
  function lookupQq(title, artist, duration, cb) {
    const queryArtist = isDj(title) ? "" : artist;
    const query = encodeURIComponent(queryTitle(title) + (queryArtist ? " " + queryArtist : ""));
    const headers = { Referer: "https://y.qq.com/", "User-Agent": MOBILE_UA };
    // QQ 旧版 client_search_cp 在部分网络下会直接 500 且要等 5 秒；
    // search_for_qq_cp 是同一个搜索服务的移动端入口，返回结构一致。
    httpGetJson("https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=" + query + "&format=json&n=10&p=1", (data) => {
      const list = data && data.data && data.data.song && data.data.song.list;
      const candidates = rankSongs(list, title, artist, duration, (item) => item.songname,
        (item) => (item.singer || []).reduce((names, a) => names.concat(artistNames(a)), []), (item) => Number(item.interval));
      tryCandidates(candidates, (picked, next) => {
        httpGetJson(
          "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=" + picked.songmid + "&format=json&nobase64=1&g_tk=5381",
          (lyric) => {
            const text = lyric && lyric.lyric;
            next(text ? { provider: "QQ Music", providerId: String(picked.songmid), syncedLyrics: text } : null);
          },
          headers,
        );
      }, cb);
    }, headers);
  }

  // Musixmatch：沿用 EeveeSpotify 的做法，先用固定 app_id 换匿名 token，
  // 再调 macro.subtitles.get 拿逐行字幕。
  function lookupMusixmatch(title, artist, duration, cb) {
    // 该接口不提供足够的场次信息，Live 曲目直接跳过。
    if (isLive(title)) { cb(null); return; }
    const queryArtist = isDj(title) ? "" : artist;
    const APP_ID = "mac-ios-v2.0";
    httpGetJson("https://apic.musixmatch.com/ws/1.1/token.get?app_id=" + APP_ID, (token) => {
      const userToken = token && token.message && token.message.body && token.message.body.user_token;
      if (!userToken) {
        cb(null);
        return;
      }
      const target =
        "https://apic.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&app_id=" + APP_ID +
        "&usertoken=" + encodeURIComponent(userToken) +
        "&track_spotify_id=" + encodeURIComponent(trackId) +
        "&subtitle_format=lrc" +
        "&q_track=" + encodeURIComponent(title) +
        (queryArtist ? "&q_artist=" + encodeURIComponent(queryArtist) : "") +
        "&user_language=zh";
      httpGetJson(target, (data) => {
        const status = data && data.message && data.message.header && data.message.header.status_code;
        const calls = data && data.message && data.message.body && data.message.body.macro_calls;
        const matched = calls && calls["matcher.track.get"] && calls["matcher.track.get"].message;
        const track = matched && matched.body && matched.body.track;
        // 字幕接口可能返回无关的默认结果，需同时校验曲目匹配与字幕状态。
        if (Number(status) !== 200 || !matched || !matched.header || Number(matched.header.status_code) !== 200 || !track || Number(track.instrumental) === 1 ||
            !matchesSong(title, artist, duration, track.track_name, track.artist_name, Number(track.track_length))) {
          cb(null);
          return;
        }
        const sub = calls && calls["track.subtitles.get"] && calls["track.subtitles.get"].message;
        const list = sub && sub.body && sub.body.subtitle_list;
        const first = Array.isArray(list) ? list[0] : null;
        const body = first && first.subtitle && first.subtitle.subtitle_body;
        if (!sub || !sub.header || Number(sub.header.status_code) !== 200 || !body || Number(first.subtitle.restricted) === 1) {
          cb(null);
          return;
        }
        cb({ provider: "Musixmatch", providerId: String(first.subtitle.subtitle_id || ""), syncedLyrics: body });
      });
    });
  }

  function withProvider(record, name) {
    const out = {};
    for (const key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    out.provider = name;
    return out;
  }

  function isSynced(record) {
    return Boolean(record && "string" == typeof record.syncedLyrics && record.syncedLyrics.trim());
  }

  function rankSongs(list, title, artist, duration, nameOf, artistOf, durationOf) {
    if (!Array.isArray(list)) return [];
    const wanted = normalize(queryTitle(title));
    const singer = normalize(artist);
    const score = (item) => {
      const name = normalize(queryTitle(nameOf(item)));
      const seconds = durationOf(item);
      return (name === wanted ? 4 : name.indexOf(wanted) === 0 ? 2 : 0)
        + (singer && matchesArtist(artist, artistOf(item)) ? 8 : 0)
        + (Number.isFinite(duration) && duration > 0 && Math.abs(seconds - duration) <= 4 ? 6 : 0);
    };
    return list.filter((item) => item && matchesSong(title, artist, duration, nameOf(item), artistOf(item), durationOf(item)))
      .sort((a, b) => score(b) - score(a)).slice(0, 3);
  }

  function isLive(title) {
    return LIVE_MARK.test(String(title));
  }

  function isDj(title) {
    return DJ_VERSION_MARK.test(String(title));
  }

  // 去掉 DJ 版本标记后再比较曲名：Spotify 写 "Song (DJ版)"，曲库可能只写
  // "Song"；括号里是 "DJ Snake Remix" 这类制作人署名时不会误删。
  function stripDjVersion(title) {
    let text = String(title);
    text = text.replace(SONG_TITLE_BRACKET_GROUP, (whole, inner) => (DJ_VERSION_MARK.test(inner) ? " " : whole));
    return text.replace(SONG_TITLE_DASH_DJ, "").replace(SONG_TITLE_LEADING_DJ, "");
  }

  function songTitle(title) {
    let text = String(title).replace(SONG_TITLE_LIVE, "").replace(SONG_TITLE_LIVE_BRACKET, "");
    // 歌手名、版本说明不参与歌名比较：Spotify 常见 "Song (feat. X)"、
    // "Song - 2011 Remaster" 而曲库只写 "Song"。
    text = stripDjVersion(text);
    text = text.replace(SONG_TITLE_DASH_FEAT, "").replace(SONG_TITLE_DASH_EDITION, "");
    text = text.replace(SONG_TITLE_BRACKET_NOISE, "");
    return normalize(text);
  }

  // 查询第三方曲库时也先去掉 feat / remaster 等后缀；Live / Acoustic / Remix
  // 这类真正决定版本的信息保留，避免把现场版查成录音室版。
  // 括号里的影视 / 节目 / 歌手等装饰信息也一并去掉；只有包含版本词时才保留。
  // DJ 版本单独去掉，先按原曲名去搜，再靠 matchesSong 的放宽规则匹配。
  function queryTitle(title) {
    let text = stripDjVersion(String(title));
    text = text.replace(SONG_TITLE_DASH_FEAT, "").replace(SONG_TITLE_DASH_EDITION, "");
    text = text.replace(SONG_TITLE_BRACKET_NOISE, "");
    text = text.replace(SONG_TITLE_BRACKET_GROUP, (whole, inner) =>
      SONG_TITLE_VERSION_BRACKET.test(inner) ? whole : " ");
    return text.replace(/\s+/g, " ").trim() || String(title);
  }

  // 曲名可能是 "Song (电影《…》主题曲)"，曲库只写 "Song"；两边都按完整曲名
  // 和去掉装饰括号后的曲名各比一次。版本词、Live、歌手等校验仍在 matchesSong
  // 里单独进行。
  function matchTitles(title, candidateTitle) {
    const wanted = [];
    for (const value of [songTitle(title), normalize(queryTitle(title))]) {
      if (value && wanted.indexOf(value) < 0) wanted.push(value);
    }
    for (const value of [songTitle(candidateTitle), normalize(queryTitle(candidateTitle))]) {
      if (value && wanted.indexOf(value) >= 0) return true;
    }
    return false;
  }

  function artistNames(person) {
    if (!person || "object" != typeof person) return [];
    return [person.name, person.trans].concat(Array.isArray(person.alias) ? person.alias : [],
      Array.isArray(person.transNames) ? person.transNames : []).filter((name) => typeof name === "string" && name.trim());
  }

  function matchesArtist(artist, candidates) {
    const names = [];
    const add = (value) => {
      if (typeof value !== "string") return;
      const text = value.trim();
      if (!text) return;
      names.push(text);
      for (const part of text.split(ARTIST_SPLIT)) {
        const name = part.trim();
        if (name) names.push(name);
      }
    };
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) add(candidate);
    } else {
      add(candidates);
    }
    // 兼容曲库的“姓, 名”写法。
    const key = (name) => normalize(String(name || "").replace(/^([^,，]+)[,，]\s*([^,，]+)$/, "$2 $1"));
    const wanted = new Set([key(artist)]);
    for (const part of String(artist || "").split(ARTIST_SPLIT)) {
      if (part.trim()) wanted.add(key(part));
    }
    wanted.delete("");
    return names.some((name) => wanted.has(key(name)));
  }

  // LRCLIB 用秒，网易云搜索用毫秒，QQ 用秒；时长可能来自任一方。
  // 大于 10000 的值按毫秒归一，避免同一首歌因为单位不同被判成两首。
  function durationSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 10000 ? number / 1000 : number;
  }

  function matchesSong(title, artist, duration, candidateTitle, candidateArtist, candidateDuration) {
    if (!candidateTitle || !matchTitles(title, candidateTitle)) return false;
    if (isLive(title) !== isLive(candidateTitle)) return false;
    if (INSTRUMENTAL_MARK.test(candidateTitle) && !INSTRUMENTAL_MARK.test(title)) return false;
    // DJ 版本经常换制作人署名，歌手对不上不代表不是同一首；时长也可能因为
    // 加长 / 剪辑差出几十秒。命中 DJ 标记时放宽这两项，其余校验照旧。
    const dj = isDj(title) || isDj(candidateTitle);
    const singer = normalize(artist);
    if (singer && !dj && !matchesArtist(artist, candidateArtist)) return false;
    const stage = STAGE_MARK.exec(title);
    const otherStage = STAGE_MARK.exec(candidateTitle);
    if (stage && otherStage && stage[1] !== otherStage[1]) return false;
    // 时长是最便宜的「同名翻唱 / 伴奏 / 剪辑版」过滤器：两边都有时长时，
    // 相差超过 10 秒基本不是同一版。缺时长（Spotify 元数据没拿到）时不拦。
    const wantedDuration = durationSeconds(duration);
    const candidateSeconds = durationSeconds(candidateDuration);
    const timed = Number.isFinite(wantedDuration) && wantedDuration > 0 &&
      Number.isFinite(candidateSeconds) && candidateSeconds > 0;
    const delta = timed ? Math.abs(candidateSeconds - wantedDuration) : 0;
    // 仅凭 “Live” 无法确定具体场次，需再核对时长和场次信息。
    if (isLive(title)) {
      if (timed && delta > (dj ? 60 : 8)) return false;
      if (stage && !otherStage && (!timed || !singer)) return false;
    } else if (timed && delta > (dj ? 60 : 10)) {
      return false;
    }
    return true;
  }

  // 候选歌词请求并行发出（最多 3 个），首个拿到可解析歌词的胜出；全部没歌词
  // 时返回 null。
  function tryCandidates(candidates, fetch, cb, limit = 3) {
    if (settled) return;
    const picked = Array.isArray(candidates) ? candidates.slice(0, limit) : [];
    if (!picked.length) { cb(null); return; }
    let pending = picked.length;
    let done = false;
    for (const candidate of picked) {
      fetch(candidate, (record) => {
        if (settled || done) return;
        if (buildPayload(record)) {
          done = true;
          cb(record);
          return;
        }
        pending -= 1;
        if (!pending) {
          done = true;
          cb(null);
        }
      });
    }
  }

  // ---- 工具函数 ---------------------------------------------------------

  function toText(value) {
    if (typeof value === "string") return value;
    if (value instanceof ArrayBuffer) return utf8.decode(new Uint8Array(value));
    if (value && ArrayBuffer.isView(value)) return utf8.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return "";
  }

  function toBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(0);
  }

  function hasLyrics(text) {
    try {
      const data = JSON.parse(text);
      const lines = data && data.lyrics && data.lyrics.lines;
      return Array.isArray(lines) && lines.some((line) => line && String(line.words || "").trim());
    } catch (e) {
      return false;
    }
  }

  function httpGetJson(target, callback, extraHeaders, timeoutMs) {
    httpGetText(target, (data) => {
      let parsed = null;
      try { parsed = data ? JSON.parse(data) : null; } catch (e) {}
      callback(parsed);
    }, extraHeaders, timeoutMs);
  }

  function httpGetText(target, callback, extraHeaders, timeoutMs) {
    if (settled) return;
    let done = false;
    const reply = (value) => {
      if (done || settled) return;
      done = true;
      callback(value);
    };
    try {
      const headers = { "User-Agent": USER_AGENT, Accept: target.indexOf("/embed/track/") >= 0 ? "text/html" : "application/json" };
      if (extraHeaders) {
        for (const key in extraHeaders) {
          if (Object.prototype.hasOwnProperty.call(extraHeaders, key)) headers[key] = extraHeaders[key];
        }
      }
      const options = { url: target, headers: headers, timeout: timeoutMs || 4000 };
      const onReply = (error, response, data) => {
        if (done || settled) return;
        const statusCode = Number(response && response.status);
        if (error || !response) {
          reply(null);
          return;
        }
        if (statusCode >= 400 || !data) {
          reply(null);
          return;
        }
        // 第三方接口不可控：超长响应不解析，避免 JSON.parse 占满内存。
        if ("string" != typeof data || data.length > MAX_HTTP_JSON_BYTES) {
          reply(null);
          return;
        }
        reply(data);
      };

      // 优先用客户端的 $httpClient；没有注入时回退到 QX 的 $task.fetch 和
      // 运行时自带的 fetch。某个客户端只实现了其中一种时也不会静默失败。
      if (typeof $httpClient !== "undefined" && $httpClient && typeof $httpClient.get === "function") {
        $httpClient.get(options, onReply);
        return;
      }
      if (typeof $task !== "undefined" && $task && typeof $task.fetch === "function") {
        $task.fetch({ url: target, headers: headers, timeout: timeoutMs || 4000 }).then(
          (res) => onReply(null, { status: res.statusCode || res.status }, res.body),
          (err) => onReply(err, null, null),
        );
        return;
      }
      if (typeof fetch === "function") {
        fetch(target, { headers: headers }).then(
          (res) => res.text().then((text) => onReply(null, { status: res.status }, text)),
          (err) => onReply(err, null, null),
        );
        return;
      }
      onReply(new Error("no http client"), null, null);
    } catch (e) {
      reply(null);
    }
  }

  function emit(payload) {
    if (protoMode) {
      const bytes = encodeProto(payload.lyrics.lines, payload.lyrics.syncType, payload.lyrics.provider,
        payload.lyrics.providerLyricsId, payload.lyrics.language, payload.colors);
      // 与官方响应头保持一致。
      finish({ status: 200, headers: { "Content-Type": "application/vnd.google.protobuf" }, body: bytes });
      return;
    }

    const body = JSON.stringify(payload);
    finish({
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: body,
    });
  }

  // ---- protobuf ---------------------------------------------------------
  //
  // 字段与官方 color-lyrics 响应一致（Content-Type: application/vnd.google.protobuf）：
  //   message Response   { LyricsData data = 1; LyricsColors colors = 2; }
  //   message LyricsData {
  //     bool timeSynchronized = 1;         // 1 = 逐行同步
  //     repeated LyricsLine lines = 2;     // 完整歌词
  //     string provider = 3;               // "MusixMatch"
  //     string providerLyricsId = 4;       // "9539392"
  //     string providerDisplayName = 5;    // "Musixmatch"
  //     bool isDenseTypeface = 8;          // 中日韩用更紧的字形
  //     string language = 10;              // "zh-Hant"
  //     LyricsRestriction restriction = 14;// 1 = showLyrics
  //     repeated LyricsLine previewLines = 17;  // 歌词卡用的前几行
  //   }
  //   message LyricsLine { int32 offsetMs = 1; string content = 2; }
  //   message LyricsColors { uint32 backgroundColor = 1; uint32 lineColor = 2; uint32 activeLineColor = 3; }
  //
  // previewLines 供 Now Playing 歌词卡使用，必须和完整歌词一起返回。

  function encodeLine(line) {
    const content = encoder.encode(String(line.words || ""));
    return pbConcat([pbUint(1, Number(line.startTimeMs) || 0), pbBytes(2, content)]);
  }

  function encodeProto(lines, syncType, provider, providerId, language, colors) {
    const parts = [pbUint(1, syncType === "LINE_SYNCED" ? 1 : 0)];
    for (let i = 0; i < lines.length; i += 1) parts.push(pbBytes(2, encodeLine(lines[i])));
    parts.push(pbBytes(3, encoder.encode(provider || "LRCLIB")));
    parts.push(pbBytes(4, encoder.encode(String(providerId === undefined || providerId === null ? "" : providerId))));
    parts.push(pbBytes(5, encoder.encode(provider || "LRCLIB")));

    const lang = String(language || "");
    const dense = /^(?:zh|ja|ko)(?:-|$)/i.test(lang);
    if (dense) parts.push(pbUint(8, 1));
    if (lang) parts.push(pbBytes(10, encoder.encode(lang)));
    parts.push(pbUint(14, 1));
    for (let i = 0; i < lines.length && i < PREVIEW_LINES; i += 1) parts.push(pbBytes(17, encodeLine(lines[i])));

    const lyrics = pbConcat(parts);
    // colors 必须给：客户端拿它刷歌词页的背景和文字，字段缺失时是 0，alpha 也是 0，
    // 整页歌词就成了透明的。JSON 用有符号整数，protobuf 这里必须还原成 uint32。
    const argb = (value) => Number(value) >>> 0;
    const palette = colors || {};
    const colorsBytes = pbConcat([
      pbUint(1, argb(palette.background === undefined ? 0xff808080 : palette.background)),
      pbUint(2, argb(palette.text === undefined ? 0xff000000 : palette.text)),
      pbUint(3, argb(palette.highlightText === undefined ? 0xffffffff : palette.highlightText)),
    ]);
    return pbConcat([pbBytes(1, lyrics), pbBytes(2, colorsBytes)]);
  }

  function inspectProto(bytes) {
    try {
      const top = pbFields(bytes);
      for (let i = 0; i < top.length; i += 1) {
        const field = top[i];
        if (field.field !== 1 || field.wire !== 2) continue;
        const inner = pbFields(field.bytes);
        let count = 0;
        for (let j = 0; j < inner.length; j += 1) {
          if (inner[j].field === 2 && inner[j].wire === 2 && inner[j].bytes && inner[j].bytes.length) count += 1;
        }
        return { count, top, lyrics: field, inner };
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  // 把 LyricsData.restriction（字段 14）统一成 1 = showLyrics。
  // 免费号额度用完时服务端回 3，客户端只显示额度提示；这里改回 1 后正常放行。
  function normalizeRestrictionProto(inspected) {
    const top = inspected.top;
    let changed = false;
    const outTop = [];
    for (let i = 0; i < top.length; i += 1) {
      const f = top[i];
      if (f !== inspected.lyrics) {
        outTop.push(pbEncodeField(f));
        continue;
      }
      const inner = inspected.inner;
      const outInner = [];
      for (let j = 0; j < inner.length; j += 1) {
        const g = inner[j];
        if (g.field === 14 && g.wire === 0) {
          if (g.value !== 1) {
            changed = true;
          }
          outInner.push(pbUint(14, 1));
          continue;
        }
        outInner.push(pbEncodeField(g));
      }
      outTop.push(pbBytes(1, pbConcat(outInner)));
    }
    return changed ? pbConcat(outTop) : null;
  }

  function stripRestrictionJson(text) {
    try {
      const data = JSON.parse(text);
      const lyrics = data && data.lyrics;
      if (!lyrics || !Object.prototype.hasOwnProperty.call(lyrics, "restriction")) return null;
      delete lyrics.restriction;
      return JSON.stringify(data);
    } catch (e) {
      return null;
    }
  }

  function pbEncodeField(f) {
    return f.raw;
  }

  // 直接拼 Uint8Array，避免逐字节 push 到普通数组：长歌词时既慢，
  // 也可能撞上 Function.prototype.apply 的参数上限。
  function pbConcat(list) {
    let size = 0;
    for (let i = 0; i < list.length; i += 1) size += list[i].length;
    const out = new Uint8Array(size);
    let at = 0;
    for (let i = 0; i < list.length; i += 1) {
      out.set(list[i], at);
      at += list[i].length;
    }
    return out;
  }

  function pbFields(bytes) {
    const out = [];
    let pos = 0;
    while (pos < bytes.length) {
      const start = pos;
      const key = pbReadVarint(bytes, pos);
      if (key.next < 0 || !Number.isSafeInteger(key.value) || key.value < 8) throw new Error("protobuf key");
      const field = Math.floor(key.value / 8);
      const wire = key.value % 8;
      if (wire === 0) {
        const value = pbReadVarint(bytes, key.next);
        if (value.next < 0) throw new Error("protobuf varint");
        out.push({ field: field, wire: 0, value: value.value });
        pos = value.next;
      } else if (wire === 2) {
        const len = pbReadVarint(bytes, key.next);
        if (len.next < 0 || !Number.isSafeInteger(len.value) || len.value > bytes.length - len.next) throw new Error("protobuf length");
        out.push({ field: field, wire: 2, bytes: bytes.subarray(len.next, len.next + len.value) });
        pos = len.next + len.value;
      } else if (wire === 5) {
        pos = key.next + 4;
        out.push({ field, wire });
      } else if (wire === 1) {
        pos = key.next + 8;
        out.push({ field, wire });
      } else {
        throw new Error("protobuf wire");
      }
      if (pos > bytes.length) throw new Error("protobuf truncated");
      out[out.length - 1].raw = bytes.subarray(start, pos);
    }
    return out;
  }

  function pbReadVarint(bytes, pos) {
    let value = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const byte = bytes[pos];
      // 绝大多数是 1-4 字节的小整数，走位运算快路径；超出后再退回乘法。
      if (shift < 28) value |= (byte & 0x7f) << shift;
      else value += (byte & 0x7f) * Math.pow(2, shift);
      pos += 1;
      if (shift === 63 && byte > 1) break;
      if ((byte & 0x80) === 0) return { value: value, next: pos };
      shift += 7;
      if (shift > 63) break;
    }
    return { value: 0, next: -1 };
  }

  function pbWriteVarint(value) {
    const out = [];
    let rest = Math.max(0, Math.floor(value));
    // 字段号 / 长度 / 毫秒时间戳都小于 2^31，位运算比 % 和 Math.floor 快。
    if (rest <= 0x7fffffff) {
      while (rest >= 128) {
        out.push((rest & 0x7f) | 0x80);
        rest >>>= 7;
      }
      out.push(rest);
      return out;
    }
    while (rest >= 128) {
      out.push((rest % 128) | 128);
      rest = Math.floor(rest / 128);
    }
    out.push(rest);
    return out;
  }

  function pbUint(field, value) {
    return pbConcat([pbWriteVarint(field * 8), pbWriteVarint(value)]);
  }

  function pbBytes(field, bytes) {
    return pbConcat([pbWriteVarint(field * 8 + 2), pbWriteVarint(bytes.length), bytes]);
  }

  function buildPayload(record) {
    if (!record || "object" != typeof record || record.instrumental) return null;

    if (typeof record.syncedLyrics === "string") {
      const lines = parseLrc(record.syncedLyrics);
      if (lines.length) return makePayload("LINE_SYNCED", lines, record);
    }

    if (typeof record.plainLyrics === "string") {
      const lines = record.plainLyrics
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((words) => ({ startTimeMs: "0", words: words, syllables: [], endTimeMs: "0" }));
      if (lines.length) return makePayload("UNSYNCED", lines, record);
    }

    return null;
  }

  // 客户端按 startTimeMs 递增定位当前行，并据此滚动列表。外部来源的行统一在这里
  // 规范化：类型转字符串、丢掉无效和空行、按时间升序，避免乱序或空文本影响定位。
  function normalizeLines(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const line of raw) {
      if (!line || typeof line.words !== "string" || !line.words.trim()) continue;
      const ms = Number(line.startTimeMs);
      if (!Number.isSafeInteger(ms) || ms < 0) continue;
      out.push({ startTimeMs: String(ms), words: line.words, syllables: [], endTimeMs: "0" });
    }
    out.sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));
    return out;
  }

  // 客户端按严格结构读取这个对象，字段形状需要与官方 color-lyrics/v2 一致：
  //
  //   { lyrics: { syncType, lines[], provider, providerLyricsId, providerDisplayName,
  //               syncLyricsUri, isDenseTypeface, alternatives, language,
  //               isRtlLanguage, fullscreenAction },
  //     colors: { background, text, highlightText },
  //     hasVocalRemoval }
  //
  // iOS 与桌面共用同一套 JSON 形状。
  function makePayload(syncType, rawLines, record) {
    const lines = normalizeLines(rawLines);
    if (!lines.length) return null;
    // 补全歌词默认转简体：先对整段做一次判定，只有繁体才逐行折叠。
    // 网易云 / QQ 的简体歌词、英文与日文歌词都不会走到逐字转换。
    if (hansLyrics && typeof SPOTIFY_HAN_VARIANTS !== "undefined") {
      const sample = [];
      for (let i = 0; i < lines.length && i < 40; i += 1) sample.push(lines[i].words);
      if (SPOTIFY_HAN_VARIANTS.isTraditional(sample)) {
        for (let i = 0; i < lines.length; i += 1) lines[i].words = SPOTIFY_HAN_VARIANTS.fold(lines[i].words);
      }
    }
    const provider = record.provider || "LRCLIB";
    const id = record.providerId !== undefined ? record.providerId : record.id;
    const language = detectLanguage(lines);
    // 值是 32 位有符号整数。
    const signed = (v) => (v > 0x7fffffff ? v - 0x100000000 : v);
    const palette = albumColors(record);
    return {
      lyrics: {
        syncType: syncType,
        lines: lines,
        provider: provider,
        providerLyricsId: id === undefined || id === null ? "" : String(id),
        providerDisplayName: provider,
        syncLyricsUri: "",
        isDenseTypeface: false,
        alternatives: [],
        language: language,
        isRtlLanguage: false,
        fullscreenAction: "FULLSCREEN_LYRICS",
      },
      colors: {
        background: signed(palette.background),
        text: signed(palette.line),
        highlightText: signed(palette.active),
      },
      hasVocalRemoval: false,
    };
  }

  // ---- 歌词页配色 -------------------------------------------------------
  //
  // 官方歌词页把封面主色当背景，未激活的行用黑字，当前 / 已唱行用白字
  // （参考 EeveeSpotify 的 LyricsColors：backgroundColor=封面提取色，
  // lineColor=黑，activeLineColor=白）。默认值 0 会让整页透明，所以必须显式给。
  // 封面色统一压到中等亮度，黑字才不会在深色封面上消失；拿不到封面色时用
  // 灰色底，与参考实现的 Color.gray 兜底一致。
  function albumColors(record) {
    const line = 0xff000000;
    const active = 0xffffffff;
    const fallback = 0xff808080;
    const source = record && record.albumColor;
    const channel = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    if (!source || !Number.isFinite(Number(source.r)) || !Number.isFinite(Number(source.g)) || !Number.isFinite(Number(source.b))) {
      return { background: fallback, line: line, active: active };
    }
    const r = channel(source.r);
    const g = channel(source.g);
    const b = channel(source.b);
    const brightness = (r * 299 + g * 587 + b * 114) / 255000;
    const amount = Math.abs(0.5 - brightness);
    const mix = (value) => (brightness < 0.5
      ? Math.round(value * (1 - amount) + 255 * amount)
      : Math.round(value * (1 - amount)));
    const background = (0xff000000 | (mix(r) << 16) | (mix(g) << 8) | mix(b)) >>> 0;
    return { background: background, line: line, active: active };
  }

  // 公开 embed 页面（__NEXT_DATA__）同时带曲目元数据与封面主色。
  function parseEmbedTrack(html) {
    try {
      const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(String(html || ""));
      const data = match && JSON.parse(match[1]);
      const entity = data && data.props && data.props.pageProps && data.props.pageProps.state && data.props.pageProps.state.data && data.props.pageProps.state.data.entity;
      if (!entity || entity.type !== "track" || entity.id !== trackId || !(entity.title || entity.name)) return null;
      const artists = Array.isArray(entity.artists)
        ? entity.artists.filter(Boolean).map((item) => item && item.name).filter((name) => typeof name === "string" && name.trim())
        : [];
      const base = entity.visualIdentity && entity.visualIdentity.backgroundBase;
      const color = base && Number.isFinite(Number(base.red)) && Number.isFinite(Number(base.green)) && Number.isFinite(Number(base.blue))
        ? { r: Number(base.red), g: Number(base.green), b: Number(base.blue) }
        : null;
      return {
        title: String(entity.title || entity.name),
        artist: artists.join(", "),
        duration: Number(entity.duration) / 1000,
        color: color,
      };
    } catch (e) {
      return null;
    }
  }

  // LRC -> Spotify 的 lines。支持一行多个时间戳、[offset:±ms]、两位或三位毫秒。
  function parseLrc(text) {
    const out = [];
    let offset = 0;

    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;

      const off = LRC_OFFSET.exec(line);
      if (off) {
        offset = parseInt(off[1], 10) || 0;
        continue;
      }

      const stamps = [];
      let m;
      LRC_STAMP.lastIndex = 0;
      while ((m = LRC_STAMP.exec(line))) stamps.push(m);
      if (!stamps.length) continue;

      const words = line.replace(LRC_BRACKET, "").trim();
      if (!words) continue;

      for (const s of stamps) {
        const minutes = parseInt(s[1], 10);
        const seconds = parseInt(s[2], 10);
        const fracRaw = s[3] || "0";
        const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
        let ms = Math.round((minutes * 60 + seconds + frac) * 1000) - offset;
        if (ms < 0) ms = 0;
        out.push({ startTimeMs: String(ms), words: words, syllables: [], endTimeMs: "0" });
      }
    }

    out.sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));
    return out;
  }

  // 同名曲目往往有好几版（原版、Video Edit、Extended Mix）。打分选版本：
  // 时长贴近的优先（时间轴才对得上），其次要有同步时间轴，其次曲名精确匹配。
  function pickRecord(list, title, duration, artist) {
    if (!Array.isArray(list) || !list.length) return null;
    const wanted = normalize(queryTitle(title));
    const usable = list.filter((item) => {
      if (!item || "object" != typeof item || item.instrumental) return false;
      if (!matchesSong(title, artist, duration, item.trackName, item.artistName, Number(item.duration))) return false;
      return Boolean(
        (typeof item.syncedLyrics === "string" && item.syncedLyrics.trim()) ||
          (typeof item.plainLyrics === "string" && item.plainLyrics.trim()),
      );
    });
    if (!usable.length) return null;

    const synced = (item) => Boolean(item.syncedLyrics && item.syncedLyrics.trim());
    const named = (item) => normalize(queryTitle(item.trackName)) === wanted;
    const near = (item) =>
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(Number(item.duration)) &&
      Math.abs(Number(item.duration) - duration) <= 3;
    const singer = normalize(artist);
    const score = (item) => (synced(item) ? 2 : 0) + (named(item) ? 1 : 0) + (near(item) ? 4 : 0)
      + (singer && matchesArtist(artist, item.artistName) ? 8 : 0);

    let best = usable[0];
    let bestScore = score(best);
    for (let i = 1; i < usable.length; i += 1) {
      const current = score(usable[i]);
      if (current > bestScore) {
        best = usable[i];
        bestScore = current;
      }
    }
    return best;
  }

  function normalize(text) {
    // NFKC 处理全角 / 组合字符。查歌词时把繁体折叠成简体再比较：
    // Spotify 与曲库的繁简写法不同也能对上（可由 ignore_han_variants 关闭）。
    const value = String(text || "");
    const folded = foldHanVariants && typeof SPOTIFY_HAN_VARIANTS !== "undefined"
      ? SPOTIFY_HAN_VARIANTS.fold(value)
      : value;
    return folded
      .normalize("NFKC")
      .toLowerCase()
      .replace(NORMALIZE_DROP, "");
  }

  function detectLanguage(lines) {
    const sample = lines
      .slice(0, 20)
      .map((line) => line.words)
      .join("");
    if (KANA_MARK.test(sample)) return "ja";
    if (HANGUL_MARK.test(sample)) return "ko";
    if (HAN_MARK.test(sample)) return "zh";
    return "en";
  }
})();
