/* Original dollhouse art. Positions are measured along the room's two floor axes;
 * the same projection anchors furniture, equipment and the characters' feet. */
(() => {
  'use strict';

  const svgNS = 'http://www.w3.org/2000/svg';
  const width = 332, depth = 286, wallHeight = 148;
  const walls = {
    basement: { top: '#c8a184', left: '#a68471', right: '#876d71', floor: '#b18d76', edge: '#665563', trim: '#e0b390', grout: '#846d69' },
    warehouse: { top: '#afd4db', left: '#7297aa', right: '#516c85', floor: '#84a3a6', edge: '#41586f', trim: '#b1d2d0', grout: '#516b7d' },
    office: { top: '#e8ba99', left: '#b99586', right: '#8a7281', floor: '#a67e6c', edge: '#695765', trim: '#e5b598', grout: '#806658' },
    mall: { top: '#e1aba6', left: '#a67d89', right: '#796476', floor: '#bb9995', edge: '#715568', trim: '#dbc2ab', grout: '#947b82' },
  };

  const wood = ['#e2b081', '#ae795f', '#845e57'];
  const walnut = ['#ac806a', '#77565b', '#614751'];
  const metal = ['#78929b', '#516476', '#344452'];
  const cream = ['#f2dbb7', '#cab49d', '#aa938c'];
  const round = n => Math.round(n * 100) / 100;
  const floorPoint = (u, v, h = 0) => [round(.90 * u - .84 * v), round(.39 * u + .42 * v - h)];
  const points = array => array.map(p => p.join(',')).join(' ');
  function poly(p, fill) { return '<polygon points="' + points(p) + '" fill="' + fill + '"/>'; }
  function traced(p, fill, stroke, weight = 1.5) { return '<path d="' + p + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + weight + '" stroke-linecap="round" stroke-linejoin="round"/>'; }
  function line(x, y, a, b, color, w = 1) { return traced('M'+x+' '+y+'L'+a+' '+b, 'none', color, w); }
  function rect(x,y,w,h,fill,r=0) { return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+r+'" fill="'+fill+'"/>'; }
  function ellipse(x,y,rx,ry,fill) { return '<ellipse cx="'+x+'" cy="'+y+'" rx="'+rx+'" ry="'+ry+'" fill="'+fill+'"/>'; }
  function group(shape, transform) { return '<g transform="'+transform+'">'+shape+'</g>'; }
  function at(shape, u, v, h=0, scale=1) {
    const [x,y] = floorPoint(u,v,h);
    return group(shape,'translate('+x+' '+y+') scale('+scale+')');
  }
  function tile(u,v,w,d,h,fill) {
    return poly([[u,v],[u+w,v],[u+w,v+d],[u,v+d]].map(p => floorPoint(...p,h)),fill);
  }
  function block(u,v,h,w,d,t,c) {
    const a=floorPoint(u,v+d,h), b=floorPoint(u+w,v+d,h), e=floorPoint(u+w,v,h);
    const A=floorPoint(u,v+d,h+t), B=floorPoint(u+w,v+d,h+t), E=floorPoint(u+w,v,h+t);
    return poly([a,b,B,A],c[1])+poly([b,e,E,B],c[2])+tile(u,v,w,d,h+t,c[0]);
  }
  // Paint on one of the two upright faces, with conventional x-right, y-down coordinates.
  function face(side,u,v,h,art) {
    const [x,y]=floorPoint(u,v,h);
    return group(art,'matrix('+(side==='front'?'.9 .39':'.84 -.42')+' 0 1 '+x+' '+y+')');
  }
  function ground(u,v,x,y,r,w,color) {
    const [a,b]=floorPoint(u,v,r),[c,d]=floorPoint(x,y,r);
    return line(a,b,c,d,color,w);
  }
  function feetShadow(u,v,w,d) {
    return tile(u+4,v+5,w+3,d,0,'#2c22372d')+tile(u+2,v+2,w,d,0,'#30243632');
  }
  function range(n, fn) { return Array.from({length:n},(_,i)=>fn(i)).join(''); }
  function shelving(u,v,w,d,h,levels) {
    const steel=['#93acb1','#697d88','#465968'];
    return block(u,v,0,3,3,h,steel)+block(u+w-3,v,0,3,3,h,steel)
      +levels.map(z=>block(u,v,z,w,d,3,wood)).join('')
      +block(u,v+d-3,0,3,3,h,steel)+block(u+w-3,v+d-3,0,3,3,h,steel);
  }
  function carton(u,v,z,w,d,h) {
    return block(u,v,z,w,d,h,['#ddaa77','#bc896d','#996f62'])
      +tile(u+w*.39,v,w*.17,d,z+h+.15,'#ebcba2')
      +face('front',u,v+d,z+h,rect(w*.39,0,w*.17,h*.34,'#e4bb92')+rect(w*.09,h*.56,w*.2,h*.16,'#efe1bd')+line(w*.09,h*.82,w*.34,h*.82,'#926154',1.3));
  }
  function bench(u,v,w,d,h) {
    return feetShadow(u,v,w,d)+[[2,2],[w-6,2],[2,d-6],[w-6,d-6]].map(([x,y])=>block(u+x,v+y,0,4,4,h,walnut)).join('')
      +block(u,v,h,w,d,4,wood)+tile(u+2,v+2,w-4,.9,h+4.1,'#f6c796');
  }
  function plant(u,v,k=1) {
    const art=ellipse(0,3,12,5,'#2d273630')+traced('M-8 -9 Q0 -13 8 -9L6 0Q0 4 -6 0Z','#bd7d65','#855968',.8)+ellipse(0,-9,8,3.5,'#e6ac81')
      +traced('M0 -9Q-2 -22 -14 -23Q-12 -13 0 -9Z','#71967b','#48645c',1)
      +traced('M0 -9Q0 -27 10 -32Q14 -22 0 -9Z','#9fb988','#5f8676',1)
      +traced('M0 -9Q7 -25 18 -22Q15 -14 0 -9Z','#619381','#456f65',1)
      +traced('M0 -9Q-11 -19 -8 -33Q1 -30 0 -9Z','#91ac79','#638670',1);
    return at(art,u,v,0,k);
  }

  function shell(loc) {
    const c=walls[loc];
    let art=at(ellipse(0,0,209,59,'url(#room-ground-shadow)'),172,154,-2)
      +block(-4,-4,-14,width+8,depth+8,13,[c.edge,'#584851','#403b49'])
      +tile(0,0,width,depth,0,c.floor);
    if(loc==='mall') {
      for(let i=0;i<8;i++) for(let j=0;j<7;j++) {
        if((i+j)%2===0) art+=tile(i*42,j*42,Math.min(42,width-i*42),Math.min(42,depth-j*42),.1,'#cfb4a3');
      }
    }
    const step=loc==='office'?22:loc==='mall'?42:53;
    for(let u=step;u<width;u+=step) art+=ground(u,0,u,depth,.2,1,c.grout);
    for(let v=step;v<depth;v+=step) {
      if(loc==='office') {
        for(let u=(Math.floor(v/step)%3)*22;u<width;u+=66) art+=ground(u,v,Math.min(width,u+22),v,.2,1,c.grout);
      } else art+=ground(0,v,width,v,.2,1,c.grout);
    }
    art+=tile(0,0,width,depth,.3,'url(#room-floor-light)');
    // Small wear marks follow the floor grain, and the walls cast shadows into the corner.
    for(let i=1;i<25;i++){
      const u=(i*127)%315+3, v=(i*71)%268+2;
      art+=ground(u,v,u+3+(i%6),v,.4,.8,'#f5ddbf33');
    }
    art+=tile(0,0,width,8,.45,'#3e35461c')+tile(0,0,7,depth,.46,'#4031411b');
    art+=block(-6,-6,0,6,depth+6,wallHeight,[c.top,c.edge,c.left])+block(0,-6,0,width,6,wallHeight,[c.top,c.right,c.edge]);
    art+=face('side',0,depth,wallHeight,rect(0,0,depth,wallHeight,'url(#room-wall-light)'))
      +face('front',0,0,wallHeight,rect(0,0,width,wallHeight,'url(#room-wall-shade)'));
    if(loc==='basement'){
      let masonry='';
      for(let y=18;y<wallHeight;y+=24){
        masonry+=line(0,y,330,y,'#534c552e',1.3);
        for(let x=(y%48===18?16:45);x<330;x+=58) masonry+=line(x,y-22,x,y,'#534c5533',1.3);
      }
      art+=face('front',0,0,wallHeight,masonry)+face('side',0,depth,wallHeight,'<g clip-path="url(#room-concrete-clip)">'+masonry+'</g>');
    }
    art+=block(-3,-3,wallHeight,6,depth+6,4,[c.trim,c.edge,c.top])+block(2,-3,wallHeight,width-2,6,4,[c.trim,c.top,c.edge]);
    art+=block(0,0,1,3,depth,7,[c.trim,c.edge,c.edge])+block(3,0,1,width-3,3,7,[c.trim,c.edge,c.edge]);
    return art;
  }

  function windowFrame(w,h,sky) {
    return rect(-3,-3,w+6,h+6,'#574e5b',2)+rect(0,0,w,h,sky)+rect(-5,h,w+10,4,'#d5b698',1);
  }
  function pegboard() {
    let holes='';
    for(let x=4;x<47;x+=6) for(let y=3;y<32;y+=6) holes+=ellipse(x,y,.8,.8,'#80645c');
    return rect(-2,-2,54,40,'#775858',1)+rect(0,0,50,35,'#c59a77',1)+holes
      +rect(7,6,11,14,'#eee3a7')+rect(9,5,4,2,'#c6896c')
      +traced('M28 5v10l-3 2M38 7v12l3 2','none','#657c7b',2.7)+rect(2,29,46,3,'#866458');
  }
  function lamp(u,v,h,pendant) {
    let shape=line(0,-h,0,-9,'#5a5158',2.4)+ellipse(0,1,29,29,'url(#room-bulb-glow)');
    if(pendant) shape+=traced('M-14 -1Q-9 -13 0 -12Q9 -13 14 -1Z','#61827c','#4d6362',1)+ellipse(0,-1,14,3,'#f0c192');
    shape+=rect(-3,-10,6,8,'#685e60',1)+ellipse(0,0,4.5,6,'#ffe5a3')+ellipse(-1,-1,1.7,3,'#fff5cf');
    return at(shape,u,v,wallHeight-h);
  }
  function basement() {
    let art=face('side',0,265,124,windowFrame(73,24,'#50596c')+rect(2,3,31,17,'#81919c')+rect(37,3,32,17,'#748596')+line(6,16,17,7,'#a9b7bd',2)+line(40,15,49,7,'#adbec3',1.5)+rect(34,0,3,24,'#463f4c'))
      +face('side',0,150,87,traced('M0 3H61Q67 3 67 10V46','none','#625e66',5)+traced('M0 2H61Q67 2 67 9V46','none','#a6a099',2)+rect(58,40,18,24,'#66616b',1)+rect(60,42,14,19,'#999394')+line(63,53,71,53,'#5f5d66',2))
      +face('front',68,0,107,pegboard())
      +face('front',130,0,125,traced('M0 0H172V45','none','#695a65',4)+traced('M0 0H172V45','none','#b79c91',1.5))
      +face('front',198,1,105,rect(0,0,67,2,'#866864')+rect(5,2,3,5,'#80645d')+rect(57,2,3,5,'#80645d')+rect(12,-12,10,12,'#ac9a88',1)+rect(13,-14,8,3,'#d3bc99')+rect(36,-17,9,17,'#829183',1)+rect(38,-20,5,4,'#aa9a7a'))
      +face('side',0,depth,wallHeight,rect(0,0,depth,wallHeight,'url(#room-lamp-wash)'))
      +lamp(46,64,35,false);
    // The washer sits on rubber feet, with a navy glass drum and a folded towel.
    art+=feetShadow(7,169,37,43)+block(7,169,1,37,43,42,cream)
      +face('front',7,212,43,rect(2,3,32,8,'#a6a5a0',1)+ellipse(28,7,2.3,2.3,'#ede2bd')+ellipse(19,25,12.1,12,'#797782')+ellipse(19,25,9.1,9.3,'#3b4e64')+traced('M13 28q4 5 10 0','none','#83a2a7',2.4))
      +block(11,176,43,23,18,3,['#d99584','#b27270','#9c696b'])+block(13,178,46,18,15,2,['#e3ad98','#ce8c7f','#ae7776'])
      +carton(11,224,0,24,22,18)+carton(13,224,18,17,17,13)
      +face('front',174,0,54,rect(0,0,8,10,'#d2b99d',1)+rect(2,2,1,3,'#554c54')+rect(5,2,1,3,'#554c54'));
    // Copper supply pipes and an old cylindrical water heater share the back wall.
    art+=at(ellipse(1,1,19,7,'#45354133')+
      traced('M-6 -60v-12h19v-12M6 -61v-8h12v-15','none','#9b7464',2.6)+
      traced('M-14 -60Q0 -68 14 -60v55Q0 3 -14 -5Z','url(#room-boiler)','#827369',1)+
      ellipse(0,-60,14,4,'#cfc7ac')+ellipse(-3,-61,4,1.5,'#8a8c81')+
      traced('M-14 -46q14 6 28 0M-14 -12q14 6 28 0','none','#a69c87',1)+
      rect(-7,-35,9,9,'#bf9d74',1)+rect(-5,-33,5,2,'#f2d4a0')+ellipse(8,-17,2.1,2.1,'#a97668'),
      297,17,1);
    let bulbs=traced('M0 0Q85 25 164 6Q211 23 288 8','none','#6f5c60',1.4);
    for(const [x,y] of [[21,5],[53,10],[85,12],[118,12],[150,8],[183,11],[215,14],[247,13],[279,9]]) {
      bulbs+=line(x,y,x,y+2.4,'#685158',1.1)+ellipse(x,y+4,5.5,5.5,'url(#room-bulb-glow)')+ellipse(x,y+4,1.55,2,'#ffe2a0');
    }
    art+=face('front',12,0,140,bulbs);
    return art;
  }

  function shelfBay(v) {
    const beams=['#98adb1','#73939d','#425f76'], shelves=['#c7b29a','#b18c76','#887375'];
    let s='';
    for(const y of [v,v+70]) s+=block(3,y,0,3,3,109,beams);
    for(const z of [9,49,89]) {
      s+=block(2,v,z,26,75,4,shelves);
      s+=carton(6,v+5,z+4,17,21,19)+carton(6,v+31,z+4,17,14,13);
      if(z!==49)s+=carton(7,v+50,z+4,15,16,16);
    }
    return s+block(26,v,0,3,3,109,beams)+block(26,v+71,0,3,3,109,beams);
  }
  function warehouse(){
    let s='';
    for(let v=24;v<depth;v+=26) s+=face('side',0,v,144,rect(0,0,1.4,136,'#7d9ba7'));
    for(let u=13;u<width;u+=33)s+=face('front',u,0,146,rect(0,0,1.6,139,'#677e95'));
    s+=face('front',132,0,122,windowFrame(102,40,'#99c5d0')+traced('M0 27l15-11 12 4 17-12 9 8 11-3 26 14 12-7v20H0Z','#7195a6','none')+traced('M0 31l14-7 11 4 20-9 15 6 17-4 25 13v6H0Z','#d1e0d6','none')+rect(49,0,4,40,'#536c82'))
      +face('front',17,0,130,rect(0,0,87,7,'#405c76',2)+rect(4,3,78,3,'#d7f2e7',1.5))
      +shelfBay(130)+shelfBay(208);
    for(let n=0;n<4;n++)s+=tile(279,200+n*14,33,6,.5,'#c5b491');
    return s;
  }

  function cityWindow() {
    const w=190,h=76;
    let s=windowFrame(w,h,'url(#room-night)')+ellipse(156,13,6,6,'#f4d49f');
    const heights=[24,32,19,48,29,34,52,41,25,32,17,27];
    heights.forEach((t,i)=>{
      const x=i*16;
      s+=rect(x,h-t,14,t,i%3===0?'#423f60':'#544b69');
      for(let j=0;j<t-7;j+=7) for(let k=0;k<2;k++) if((i+j+k)%3)s+=rect(x+3+k*5,h-t+5+j,2.2,3.4,(i+j)%3?'#ce9f86':'#849eaf');
    });
    for(const x of [0,48,96,144,187])s+=rect(x,0,3,h,'#4b4859');
    return s+rect(0,25,w,2,'#68576a');
  }
  function office(){
    return face('front',104,0,127,cityWindow())
      +face('side',0,243,120,rect(0,0,54,48,'#645761',1)+rect(3,3,48,42,'#f1cead')+traced('M4 40l12-18 9 8 10-17 16 28Z','#8aa18e','none')+ellipse(15,13,5,5,'#dc9779'))
      +face('side',0,156,84,rect(0,0,70,3,'#96766b')+rect(5,-16,4,16,'#876c79')+rect(10,-21,5,21,'#acc2ad')+rect(17,-17,5,17,'#d5a57e')+rect(23,-20,3,20,'#855e66')+rect(45,-7,12,7,'#e9bf9e',2))
      +bench(12,170,44,37,33)+block(16,175,37,18,15,2,cream)+plant(17,230,1.45)
      +lamp(45,48,28,true);
  }
  function mall(){
    function shop(w,sign,color){
      let a=rect(-3,-2,w+6,84,'#5b515e',2)+rect(0,2,w,20,color)+rect(0,24,w,57,'#796c76');
      if(sign) a+=group(traced('M8 1H2Q0 1 0 3V4Q0 6 2 6H6Q8 6 8 8V10Q8 12 6 12H0 M12 12l4-11h2l4 11 M14 8h6 M27 1v11h8 M47 1h-8v11h8 M39 6h6','none','#fff0d1',2.1),'translate('+((w-47)/2)+' 5)');
      else a+=rect(w*.22,10,w*.56,3,'#d9bba6',1);
      for(let i=27;i<81;i+=6) a+=rect(1,i,w-2,1.3,'#a28b91');
      return a+rect(-4,81,w+8,3,'#c2a69d');
    }
    let s=face('front',16,0,108,shop(87,true,'#a96070'))+face('front',125,0,104,shop(113,false,'#79847b'))
        +face('side',0,255,115,rect(0,0,69,70,'#665764',2)+rect(3,3,63,61,'#958087')+rect(7,8,54,11,'#6f6472')+traced('M12 30h16v13h18v11','none','#d3b7a0',3)+ellipse(14,30,3,3,'#e6ae82'));
    // Two stationary rails and stair treads, ascending toward the back of the hall.
    for(let n=0;n<10;n++)s+=block(7,162+n*8,0,32,8,(10-n)*4.8,['#b1a2a1','#8a818b','#696575']);
    for(const u of [5,40]){
      const a=floorPoint(u,161,63),b=floorPoint(u,244,15),c=floorPoint(u,244,4),e=floorPoint(u,161,51);
      s+=poly([a,b,c,e],'#9ca0a1')+line(...a,...b,'#535161',3);
    }
    return s+plant(18,265,1.04);
  }

  // Each machine shares a single drawing across its slots. Details sit on the same
  // planes as the furniture, so the monitor lids, vents and lamps stay in perspective.
  function laptop() {
    const screen=block(1,2,1,24,2,17,['#b1b7aa','#546270','#414859'])
      +face('front',2,4.1,17,rect(0,0,22,14,'#263d47',1)+rect(1.3,1.1,19,11,'url(#room-screen)')+line(3,5,11,5,'#b1efc1',.9)+line(3,7,8,7,'#7ddbb1',.8));
    return screen+block(0,4,0,26,15,1.5,['#9da69e','#68787c','#53636d'])
      +tile(2,5,22,6,1.7,'#55626d')+tile(10,14,6,3,1.7,'#bdc0ae');
  }
  function tower() {
    let a=block(0,0,0,17,25,33,cream);
    a+=face('front',0,25.1,33,rect(2,3,13,4,'#7f8184',.8)+rect(3,4,9,1,'#bbb9a8')+rect(2,10,12,2,'#a59e91')+ellipse(12,18,1.7,1.7,'#76ae9b')+range(4,i=>rect(3,23+i*1.5,10,.6,'#8a8983')));
    return a+face('side',17.1,24,29,range(5,i=>line(3+i*2,14,3+i*2,23,'#918e86',.8)));
  }
  function rack(){
    let a=block(0,0,0,30,28,64,metal);
    a+=face('front',0,28.1,64,rect(2,2,26,59,'#333e4f',1.2)+range(8,i=>rect(4,5+i*6.6,22,4.8,i%2?'#667684':'#77848a',.8)+rect(6,6.5+i*6.6,11,1,'#394651')+ellipse(22,7.4+i*6.6,1,1,i%3?'#a2d6ac':'#e5b47d')));
    return a+face('side',30.1,26,56,range(5,i=>line(4+i*3,33,4+i*3,46,'#495768',.85)));
  }
  function gpu(){
    let a=block(0,0,0,42,24,3,metal)+block(0,0,3,3,3,25,metal)+block(38,0,3,3,3,25,metal);
    for(let i=0;i<5;i++)a+=block(2+i*7.5,3,4,4,16,14,['#b0ada0','#797984','#394b5a'])
      +face('side',6+i*7.5,18,18,ellipse(7,7,5.5,5.5,'#334550')+ellipse(7,7,3,3,'#77958b')+ellipse(7,7,1.2,1.2,'#41565a'));
    return a+block(0,21,3,3,3,25,metal)+block(38,21,3,3,3,25,metal)+block(0,0,27,42,2,2,metal)+block(0,21,27,42,3,2,metal)+block(0,2,27,3,19,2,metal)+block(38,2,27,3,19,2,metal)
      +face('front',2,24,8,line(0,1,20,1,'#d7ac78',1.5));
  }
  function cluster(){
    let a=block(0,0,0,40,31,70,['#647a83','#3c495c','#2f374a']);
    for(let i=0;i<3;i++){
      a+=face('front',2+i*12,31.2,68,rect(0,0,10,64,'#667883',1)+rect(1,2,8,59,'#293b4c',1)+range(7,j=>rect(2.5,5+j*8,5,2.3,i===1?'#96dac2':'#75aeb7',.6)));
    }
    return a+face('side',40,30,65,rect(4,2,22,53,'#354456',1)+range(6,i=>line(7,5+i*8,23,5+i*8,'#526375',1)));
  }
  function mainframe(){
    const c=['#b2bcc1','#58697e','#41495d'];
    let a=block(0,0,0,34,34,5,c)+block(3,3,5,28,28,67,['#798ca0','#485976','#37495e'])
      +block(0,0,72,34,34,5,c);
    a+=face('front',4,31.2,68,rect(0,0,26,57,'#283e59',2)+traced('M2 3H23L18 15H7Z','#9ee1dc','#6b9aa7',1)
      +traced('M7 16h12l-2 15h-8Z','#d9b587','#ad8b84',1.4)+traced('M9 32h8l-1 13h-6Z','#8ed6d0','#577e9b',1)+line(13,44,13,54,'#e4c3a4',1.5));
    return a+face('side',31.1,29,67,rect(1,1,22,44,'#3c556c',1)+range(6,i=>line(4,6+i*5,19,6+i*5,'#79929e',1.4)));
  }
  function fan() {
    return block(0,0,1,22,11,24,['#aec1b0','#839e9b','#677e84'])
      +face('front',0,11.1,25,rect(2,2,18,19,'#455d63',2)+ellipse(11,11,8,8,'#6d8b8c')+ellipse(11,11,5,5,'#3c565f')+range(7,i=>line(4+i*2.3,5,4+i*2.3,18,'#a5b9ae',.7)))
      +block(1,7,0,4,6,1,metal)+block(16,7,0,4,6,1,metal);
  }
  function ac(){
    return block(0,0,0,15,44,21,['#b9c9c7','#b3b5ad','#8c9ba4'])+
      face('side',15.1,43,20,rect(1,1,40,17,'#a1b4b2',2)+range(6,i=>line(4,4+i*2,28,4+i*2,'#586b78',1.1))+rect(32,5,5,4,'#8bd3bf')+ellipse(34,14,1.5,1.5,'#d7d6b9'));
  }
  function liquid(){
    return block(0,0,0,26,29,5,metal)+block(5,4,5,16,18,27,['#8ab7bd','#527e96','#41677c'])
      +face('front',6,22.2,30,rect(0,0,14,21,'#6ab1bc',2)+rect(2,8,10,11,'#80ddc6',2)+line(3,3,3,16,'#b9ecda',1.3))
      +face('side',26,28,8,traced('M0 2q4 -17 14 -19q7 -2 7 12v5','none','#4f9eaa',3));
  }
  function worker(role){
    const colors={sibling:['#cf8c69','#e1ae89','#614b49','#b5cd91'],sysadmin:['#a6bfba','#ad7c62','#4b4245','#506e77'],manager:['#a993b4','#d8a182','#785753','#555569']}[role];
    let s=ellipse(1,1,10,3.3,'#392d3c30')
      +traced('M-5 -13l-1 11 -3 1M4 -13l0 12 4 0','none',colors[3],3.4)
      +traced('M-8 -21q4-5 9-4q6 0 7 8l-1 6q-7 2-15-1z',colors[0],'#5e5962',.8)
      +ellipse(.8,-29,6.1,7.1,colors[1])+traced('M-5 -25q-5-13 6-13q8 1 7 9l-3-4-7 1z',colors[2],'none')
      +ellipse(4,-29,1,.9,'#483d46');
    if(role==='manager') s+=traced('M5 -21l7 1-2 11-7-1z','#ddbe93','#826d64',1)+traced('M-3 -21q3 7 8 5','none',colors[1],2.8);
    if(role==='sysadmin')s+=line(0,-29,7,-30,'#343b43',1.6)+traced('M-7 -20l-3 6 5 2','none',colors[1],2.8);
    if(role==='sibling')s+=traced('M-3 -21l5 5 8-2','none',colors[1],2.8)
      +traced('M-8 -14q6 -2 13 2l-1 10-12-2z','#a9816a','#795f5f',1)
      +traced('M-6 -4l-1 7M2 -2v6','none','#68565a',2);
    return s;
  }

  function studio(loc){
    let art=shell(loc)+({basement,warehouse,office,mall}[loc])();
    // Cable trays, a low-pile rug and a workbench give a fresh room a place to begin.
    const rug={basement:['#916c69','#c49b85'],warehouse:['#68838e','#acb7a5'],office:['#9c726e','#d4ae88'],mall:['#a17b86','#c5a7a1']}[loc];
    art+=tile(47,145,136,112,.6,rug[0])+tile(50,148,130,2,.7,rug[1])+tile(50,251,130,2,.7,rug[1])
      +tile(50,149,2,102,.7,rug[1])+tile(178,149,2,102,.7,rug[1])
      +ground(76,162,76,42,1.2,2.1,'#594f58')+ground(76,42,166,42,1.2,2.1,'#594f58')+ground(166,42,166,7,1.2,2.1,'#594f58')
      +bench(54,174,94,40,33)+carton(64,182,0,19,14,15)
      +tile(127,181,13,13,37.3,'#e0cfb2')+tile(129,183,9,1,37.4,'#a1948c')
      +at(rect(-2,-4,4,4,'#cc9077',.7)+ellipse(0,-4,2.3,1,'#f4cda1')+traced('M2 -4q4 0 2 2','none','#c88973',1),141,179,37);
    if(loc==='basement')art+=carton(275,210,0,29,30,21)+carton(277,213,21,20,21,15)+carton(296,243,0,16,17,12);
    else if(loc==='warehouse')art+=carton(277,219,0,29,25,20)+carton(276,244,0,20,17,19);
    else if(loc==='office')art+=plant(295,234,1.3);
    else art+=carton(294,239,0,18,19,12);
    return art;
  }
  const spriteArt={laptop,tower,rack,gpu,cluster,mainframe,fan,ac,liquid,
    sibling:()=>worker('sibling'),sysadmin:()=>worker('sysadmin'),manager:()=>worker('manager')};
  // Coordinates are permanent parking spots. New purchases never shuffle another stack.
  const slots={
    ac:[[4,178,83]],rack:[[79,27],[116,27]],gpu:[[125,83],[171,83]],
    cluster:[[186,17],[233,17]],mainframe:[[286,40]],
    sysadmin:[[175,134]],sibling:[[97,222]],liquid:[[271,141]],manager:[[227,224]],
    laptop:[[58,185,37],[89,185,37],[118,185,37]],tower:[[160,205],[182,205]],fan:[[27,253],[55,253]],
  };
  function defs(withSprites){
    // <use> retains individual slot positions and quantities. A shared SVG image per
    // model lets the browser cache its fine detail across instances and HUD updates.
    const sprites=withSprites?Object.entries(spriteArt).map(([id,draw])=>{
      const art='<svg xmlns="'+svgNS+'" viewBox="-30 -85 82 122"><defs>'+screenGradient+'</defs>'+draw()+'</svg>';
      return '<image id="doll-'+id+'" x="-30" y="-85" width="82" height="122" href="data:image/svg+xml;charset=utf-8,'+encodeURIComponent(art)+'"/>';
    }).join(''):'';
    return '<defs>'+sprites+
      '<linearGradient id="room-night" x2=".3" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#373c64"/><stop offset="1" stop-color="#bd8690"/></linearGradient>'+
      '<linearGradient id="room-wall-light" x2="1" y2=".6"><stop stop-color="#f8cc9e" stop-opacity=".17"/><stop offset="1" stop-color="#ffd6a7" stop-opacity=".02"/></linearGradient>'+
      '<linearGradient id="room-wall-shade" x2="1" y2=".6"><stop stop-color="#37263b" stop-opacity=".12"/><stop offset="1" stop-color="#352639" stop-opacity=".01"/></linearGradient>'+
      '<radialGradient id="room-ground-shadow"><stop stop-color="#16101c" stop-opacity=".72"/><stop offset="1" stop-color="#16101c" stop-opacity="0"/></radialGradient>'+
      '<radialGradient id="room-floor-light" cx=".33" cy=".35" r=".8"><stop stop-color="#ffdf9d" stop-opacity=".45"/><stop offset=".52" stop-color="#ffe8bf" stop-opacity=".07"/><stop offset="1" stop-color="#382c48" stop-opacity=".17"/></radialGradient>'+
      '<radialGradient id="room-lamp-wash" cx=".72" cy=".3" r=".7"><stop stop-color="#ffe39c" stop-opacity=".4"/><stop offset="1" stop-color="#ffc192" stop-opacity="0"/></radialGradient>'+
      '<linearGradient id="room-boiler"><stop stop-color="#ada897"/><stop offset=".36" stop-color="#d5ceb4"/><stop offset=".78" stop-color="#b6ad98"/><stop offset="1" stop-color="#9f9385"/></linearGradient>'+
      '<radialGradient id="room-bulb-glow"><stop stop-color="#fff1a8" stop-opacity=".8"/><stop offset=".38" stop-color="#ffdb94" stop-opacity=".32"/><stop offset="1" stop-color="#ffe0b0" stop-opacity="0"/></radialGradient>'+
      '<clipPath id="room-concrete-clip"><rect width="'+depth+'" height="'+wallHeight+'"/></clipPath></defs>';
  }
  const screenGradient='<linearGradient id="room-screen" x2="0" y2="1"><stop stop-color="#598583"/><stop offset="1" stop-color="#416668"/></linearGradient>';
  function create(name, attrs={}) {
    const node=document.createElementNS(svgNS,name);
    for(const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value));
    return node;
  }

  function enableRoomDrag(container, svg) {
    const hitArea=container.parentElement;
    const prefersStill=matchMedia('(prefers-reduced-motion: reduce)');
    let start=null, dragged=false;
    hitArea.addEventListener('pointerdown',event=>{
      if(!event.isPrimary) return;
      dragged=false;
      start=prefersStill.matches || document.body.classList.contains('effects-reduced')
        ? null : {id:event.pointerId,x:event.clientX,y:event.clientY};
    });
    hitArea.addEventListener('pointermove',event=>{
      if(!start || start.id!==event.pointerId) return;
      const dx=event.clientX-start.x,dy=event.clientY-start.y;
      if(!dragged && Math.abs(dx)+Math.abs(dy)<9) return;
      dragged=true;
      const shift=n=>Math.max(-5,Math.min(5,n/12));
      svg.style.transform='translate('+shift(dx)+'px,'+shift(dy)+'px)';
    });
    for(const type of ['pointerup','pointercancel','pointerleave']){
      hitArea.addEventListener(type,event=>{
        if(!start || event.pointerId!==start.id) return;
        start=null;
        if(dragged) svg.style.removeProperty('transform');
      });
    }
    hitArea.addEventListener('click',event=>{
      if(dragged && event.detail){dragged=false;event.stopImmediatePropagation();}
    },true);
  }

  function mount(container) {
    const frame=document.createElement('div');
    frame.className='doll-picture';
    const scenery=document.createElement('img');
    scenery.className='doll-scenery';scenery.alt='';scenery.draggable=false;
    const backgrounds=new Map();
    const svg=create('svg',{viewBox:'-263 -174 587 463',class:'dollhouse',role:'img','aria-label':'Startup room'});
    svg.innerHTML=defs(true);
    const clutter=create('g',{'aria-hidden':'true'}),things=create('g'),badges=create('g',{'aria-hidden':'true'});
    svg.append(clutter,things,badges);
    const circuit=document.createElement('div');
    circuit.className='doll-lights';circuit.setAttribute('aria-hidden','true');
    frame.append(scenery,svg,circuit);
    container.replaceChildren(frame);
    enableRoomDrag(container,frame);
    // Only these tiny layers animate continuously. The dense room and machine paths
    // stay on separate static surfaces instead of being repainted on each LED blink.
    function light(kind,u,v,z,size){
      const node=document.createElement('span');
      const [x,y]=floorPoint(u,v,z);
      node.className='doll-effect doll-'+kind;
      node.setAttribute('aria-hidden','true');
      node.style.left=(100*(x+263-size/2)/587)+'%';node.style.top=(100*(y+174-size/2)/463)+'%';
      node.style.width=(100*size/587)+'%';node.style.height=(100*size/463)+'%';
      if(kind==='rotor'){
        node.innerHTML='<svg viewBox="0 0 22 22" aria-hidden="true"><path d="M11 11Q-2 10 4 4Q8 3 11 11M11 11Q12 -2 19 5Q20 10 11 11M11 11Q21 20 14 21Q9 20 11 11" fill="#bdcfbf"/><circle cx="11" cy="11" r="1.8" fill="#546d76"/></svg>';
      }
      (kind==='led'?circuit:frame).append(node);
      return node;
    }
    const indicatorPositions={rack:[22,28,57],cluster:[7,31,58],mainframe:[15,31,12],tower:[12,25,15],laptop:[6,4,12],gpu:[8,24,7],fan:[11,11.2,14]};
    let signLight;
    let lastLocation='',lastStage=-1;
    const groups=new Map();
    // Keep a stable paint order and update only the equipment count that changed.
    const order=Object.keys(slots).sort((a,b)=>{
      const [,ya]=floorPoint(...slots[a][0].slice(0,2)),[,yb]=floorPoint(...slots[b][0].slice(0,2));
      return ya-yb;
    });
    for(const id of order){
      const node=create('g',{'data-model':id});
      things.append(node);
      groups.set(id,{node,count:0,sprites:[],badge:null});
    }
    function render(state,stage,drops) {
      let changed=lastLocation!==state.location;
      if(changed){
        if(!backgrounds.has(state.location)){
          const image='<svg xmlns="'+svgNS+'" viewBox="-263 -174 587 463">'+defs(false)+studio(state.location)+'</svg>';
          backgrounds.set(state.location,'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(image));
        }
        scenery.src=backgrounds.get(state.location);
        if(state.location==='mall'){
          signLight=light('neon',56,1,93,46);
        }else if(signLight){signLight.remove();signLight=null;}
        lastLocation=state.location;
      }
      if(lastStage!==stage){
        const cable=(stage>=1?ground(136,161,199,161,1,2,'#665966')+ground(199,161,199,81,1,2,'#665966'):'');
        clutter.innerHTML=cable+(stage>=2?carton(11,84,0,18,21,12):'')+(stage>=3?carton(10,90,12,14,14,12):'');
        lastStage=stage;
      }
      for(const id of order){
        const n=state.machines[id]??state.coolers[id]??state.staff[id]??0;
        const g=groups.get(id);
        if(g.count===n) continue;
        changed=true;
        const marks=slots[id],wanted=Math.min(n,marks.length);
        if(n){
          g.node.setAttribute('data-equipment',id);
          g.node.setAttribute('data-count',String(n));
          if(!g.light && indicatorPositions[id]){
            const [u,v,z=0]=marks[0], [dx,dy,dz]=indicatorPositions[id];
            g.light=light(id==='fan'?'rotor':'led',u+dx,v+dy,z+dz,id==='fan'?14:3);
          }
        }else{
          g.node.removeAttribute('data-equipment');
          g.node.removeAttribute('data-count');
          if(g.light){g.light.remove();g.light=null;}
        }
        while(g.sprites.length>wanted)g.sprites.pop().remove();
        while(g.sprites.length<wanted){
          const [u,v,z=0]=marks[g.sprites.length], [x,y]=floorPoint(u,v,z);
          const socket=create('g',{transform:'translate('+x+' '+y+')'});
          const unit=create('g',{class:'doll-unit'});
          const footprint={laptop:[26,15],tower:[17,25],rack:[30,28],gpu:[42,24],cluster:[40,31],mainframe:[34,34],fan:[22,11],liquid:[26,29]}[id];
          if(footprint)unit.innerHTML=feetShadow(0,0,...footprint);
          unit.append(create('use',{href:'#doll-'+id}));
          if(drops>0){
            unit.classList.add('doll-arriving');
            unit.addEventListener('animationend',()=>unit.classList.remove('doll-arriving'),{once:true});
            drops--;
          }
          socket.append(unit);g.node.append(socket);g.sprites.push(socket);
        }
        if(n>wanted && !(id in state.staff)){
          if(!g.badge){
            const [u,v,z=0]=marks[0], [x,y]=floorPoint(u,v,z);
            const offsets={laptop:[17,23],tower:[10,20],rack:[9,22],gpu:[14,23],ac:[7,17],fan:[1,19],liquid:[8,22],cluster:[9,24],mainframe:[7,24]};
            const [dx,dy]=offsets[id];
            g.badge=create('g',{class:'doll-count',transform:'translate('+(x+dx)+' '+(y+dy)+')'});
            g.badge.append(create('rect',{x:-2,y:0,width:28,height:14,rx:6}),create('text',{x:12,y:10.7,'text-anchor':'middle'}));
            badges.append(g.badge);
          }
          const text='×'+(n>=1000?(n/1000).toFixed(1).replace(/\.0$/,'')+'k':n);
          g.badge.lastChild.textContent=text;
          const w=Math.max(28,6+text.length*6.6);
          g.badge.firstChild.setAttribute('width',w);g.badge.lastChild.setAttribute('x',w/2-2);
        }else if(g.badge){g.badge.remove();g.badge=null;}
        g.count=n;
      }
      if(changed){
        const labels={laptop:'Old Laptop',tower:'Desktop Tower',rack:'Rack Server',gpu:'GPU Rig',cluster:'AI Training Cluster',mainframe:'Quantum Mainframe',ac:'Window AC',fan:'Box Fan',liquid:'Liquid Loop',sibling:'Little Sibling',sysadmin:'Sysadmin',manager:'Purchasing Manager'};
        const names={basement:'The Basement',warehouse:'The Warehouse',office:'The Office',mall:'The Mall'};
        const contents=order.filter(id=>groups.get(id).count).map(id=>labels[id]+(id in state.staff?' level ':' ×')+groups.get(id).count);
        svg.setAttribute('aria-label',names[state.location]+'. '+(contents.length?contents.join(', '):'An empty workbench is ready for your first laptop.'));
      }
    }
    return {render};
  }
  window.RoomScene={mount};
})();
