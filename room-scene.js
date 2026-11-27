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
    dam: { top: '#adc5aa', left: '#809b91', right: '#627d7c', floor: '#92a99b', edge: '#4c6968', trim: '#c7c9a5', grout: '#738d85' },
    penthouse: { top: '#eed1b4', left: '#ccab97', right: '#b18f90', floor: '#c7ae98', edge: '#817078', trim: '#ead0ab', grout: '#a28a7b' },
    bunker: { top: '#97a18a', left: '#768472', right: '#69766c', floor: '#899485', edge: '#4a5b56', trim: '#adb198', grout: '#66766d' },
    orbital: { top: '#d9e1d1', left: '#a5b6ba', right: '#8b9da9', floor: '#a6b4b6', edge: '#5d7184', trim: '#cedcd3', grout: '#83959e' },
    volcano: { top: '#b58b82', left: '#836572', right: '#745662', floor: '#926e73', edge: '#523f50', trim: '#bd907a', grout: '#705461' },
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


  // Three spillways, a pipe gallery and a bronze generator share the turbine hall.
  function dam() {
    const water = '#8fd7c8', foam = '#d2f1dc';
    let river = rect(0, 0, 252, 72, '#b7d9cc')
      + traced('M0 29L24 14l18 6 27-16 24 17 31-15 28 13 24-9 34 17 24-15 18 10v22H0Z', '#72958c', 'none')
      + rect(0, 29, 252, 43, '#548e92')
      + traced('M0 36q33-5 68-2t73 0t111-1', 'none', '#abddca', 2);
    for (const x of [10, 89, 168]) {
      river += rect(x, 35, 71, 37, '#627d7d') + rect(x + 3, 38, 65, 5, '#435c62')
        + group(traced('M0 0h61l4 9v22H-3V13Z', water, 'none'), 'translate(' + (x + 5) + ' 41)')
        + range(6, i => line(x + 7 + i * 10, 43, x + 4 + i * 10, 68 - i % 3 * 3, foam, 1.7));
    }
    let pipes = '';
    for (const x of [7, 55, 103]) {
      pipes += rect(x, 0, 35, 87, '#507779', 9) + rect(x + 6, 0, 20, 87, '#79a7a0', 7)
        + rect(x + 9, 2, 4, 81, '#b1c7af', 2)
        + [18, 54, 80].map(y => rect(x - 2, y, 39, 4, '#44676d', 1) + rect(x, y, 32, 1, '#b7c9ad')).join('');
    }
    const generator = ellipse(0, 1, 20, 7, '#314c503b') + rect(-17,-19,34,17,'#486e69')
      + ellipse(0,-3,17,6,'#486e69') + ellipse(0,-19,18,7,'#b5ac79')
      + ellipse(0,-21,14,5,'#608d79') + ellipse(0,-23,5,2.6,'#dec695');
    return face('front', 39, 0, 134, windowFrame(252, 72, water) + river + rect(0, 31, 252, 2, '#d7e2ca'))
      + face('side', 0, 242, 131, pipes)
      + at(generator, 16, 181) + at(generator, 16, 229)
      + face('front', 16, 0, 62, rect(0,0,29,24,'#426067',2) + ellipse(9,9,5,5,'#e8d9a5') + line(9,9,12,6,'#8e6556',1.4)
        + ellipse(21,9,4,4,'#ced6b7') + rect(5,18,16,2,'#80c6a0'));
  }

  function penthouse() {
    function panorama(w, heights) {
      let sky = rect(0, 0, w, 86, 'url(#room-penthouse-dusk)')
        + group(traced('M0 62q29-13 54-7t52-3t67 4t77-6v36H0Z', '#a098a5', 'none'), 'scale('+(w/250)+' 1)');
      for (let i = 0; i < heights.length; i++) {
        const x = i * 21, h = heights[i];
        sky += rect(x, 86 - h, 19, h, i % 2 ? '#706e85' : '#756a7d')
          + range(Math.floor(h / 8), y => rect(x + 3, 89 - h + y * 8, 3, 2.5, '#d7bc9c')
            + rect(x + 12, 89 - h + y * 8, 3, 2.5, '#b4a7a4'));
      }
      for (let x = 0; x < w; x += 43) sky += rect(x, 0, 2.3, 86, '#75626b');
      return sky;
    }
    const left = windowFrame(126, 86, '#e1ab9e') + panorama(126, [12,22,31,15,29,18]);
    const right = windowFrame(250, 86, '#e1ab9e') + panorama(250, [26,17,29,20,34,14,26,22,36,53,27,16])
      + ellipse(176,18,10,10,'#f9d3a8') + line(198,31,198,14,'#756a7d',1.2);
    const sofa = ['#dfac91', '#be8576', '#926977'];
    return face('side', 0, 137, 135, left) + face('front', 7, 0, 135, right)
      + face('side', 0, 268, 124, range(9, i => rect(i*5,0,2.6,96,'#af7c70')))
      + block(9,185,2,24,54,6,walnut) + block(7,184,8,26,57,8,sofa)
      + block(7,184,16,6,57,15,sofa) + block(12,183,16,22,5,9,sofa) + block(12,236,16,22,5,9,sofa)
      + plant(19, 264, 1.5)
      + face('front', 277, 0, 129, rect(0,0,36,43,'#ba986f',1)+rect(2,2,32,39,'#e6c6ad')
        + traced('M4 32q12-29 23-17q4 7-5 11q-10 3-7-12','none','#8e686c',2.6))
      + at(line(0,-46,0,-6,'#9c8174',1.7)+ellipse(0,1,12,7,'#ebbf91')+ellipse(0,1,8,4,'#f9d7ae'),50,61,103);
  }

  function bunker() {
    const olive = '#70846c', pale = '#aeb6a0';
    const blastDoor = rect(0,0,95,111,'#404f50',6) + rect(4,3,87,108,'#829284',5)
      + rect(9,8,77,98,'#596a61',4) + rect(14,13,67,88,olive,3)
      + rect(20,19,56,12,'#465c54',2) + rect(22,22,51,4,'#9ba893',1)
      + ellipse(45,55,18,18,'#4a5a56') + ellipse(45,55,14,14,'#9da691') + ellipse(45,55,11,11,'#5d7063')
      + range(4, i => group(line(45,43,45,67,'#bbc1a6',2.1),'rotate('+(i*45)+' 45 55)'))
      + ellipse(45,55,3.5,3.5,'#d1bd8b')
      + [19,48,83].map(y => rect(2,y,11,6,'#adb49c',1) + rect(81,y,11,6,'#adb49c',1)).join('');
    let plotting = rect(0,0,102,61,'#4e5c54',2)+rect(4,4,94,51,'#b8b595');
    plotting += range(6, i => line(8+i*16,6,8+i*16,53,'#979e86',.8))
      + range(4, i => line(6,9+i*12,96,9+i*12,'#979e86',.8))
      + traced('M8 35l14-5 11-13 12 4 9-9 21 3 16 13-7 8-19 2-11 13-17-4-18 2Z','#929f86','#758771',1)
      + traced('M17 36l17-10 20 9 23-14','none','#b77e65',2)
      + [17,34,54,77].map((x,i)=>ellipse(x,[36,26,35,21][i],2.5,2.5,'#8f6254')).join('');
    const siren=rect(-10,0,20,5,'#5a625a',1)+traced('M-7 0v-8q0-8 7-8t7 8v8Z','#d3916c','#816659',1.3)
      + line(-4,-9,-4,-5,'#f2c093',1.6);
    return face('front',49,0,130,blastDoor) + face('front',169,0,125,plotting)
      + face('side',0,242,126,traced('M0 9h210 M0 16h210','none','#53655e',4)
        + range(6, i=>rect(11+i*37,5,4,16,pale,1)))
      + face('side',0,236,84,rect(0,0,45,35,'#485951',2) + range(6,i=>rect(5,4+i*4.5,35,1.7,'#a2ad98')))
      + face('front',96,0,145,siren)
      + range(3,i=>block(8,174+i*25,0,21,24,10,['#aaa786','#818469','#6a705f']))
      + range(2,i=>block(8,188+i*25,10,20,24,9,['#b4ad91','#929072','#76735e']));
  }

  function orbital() {
    const stars = range(28,i => ellipse((9+i*53)%189, (4+i*29)%65, i%5===0?1.5:.8, i%5===0?1.5:.8, '#e0e9dd'));
    const aperture = 'M15 0H173L190 15V55L174 72H15L0 57V16Z';
    const window = traced(aperture,'#243648','#a9b8b8',8)
      + '<defs><clipPath id="room-cupola"><path d="'+aperture+'"/></clipPath></defs><g clip-path="url(#room-cupola)">'
      + rect(0,0,190,72,'#29374f') + stars
      + traced('M-7 73Q76 5 198 40V86H-7Z','#76aeb9','#bad8da',2.4)
      + traced('M25 72q24-19 54-26l29 5 8 8-21 6-14-4-16 8-25 3zM133 44l29 3 14 8-18 7-11-8-18-2z','#99bd9a','none')
      + traced('M17 71q30-22 59-23m26-4q24-4 49 1m-72 22q20-8 51-4','none','#d5e0d5',2)
      + traced('M36 0l15 24v35L39 74 M156 0l-14 23v33l16 18', 'none','#7a899a',4)
      + '</g>';
    const porthole = ellipse(0,0,21,21,'#6e8290') + ellipse(0,0,17,17,'#b9c4be') + ellipse(0,0,14,14,'#34465e')
      + ellipse(4,-3,2,2,'#c3d8dc') + line(-8,8,-3,5,'#a2c2ca',1.3);
    const lock = rect(0,0,61,84,'#70808d',5)+rect(4,4,53,77,'#c8cec2',4)
      + traced('M14 8h31l5 9v40l-6 12H15l-6-11V16Z','#99a8a8','#697d88',1.8)
      + rect(14,24,30,15,'#586976',4)+rect(16,26,26,10,'#789a9e',3)+rect(18,52,21,4,'#59757d',2);
    return face('front',96,0,131,window) + face('side',0,198,130,lock)
      + [74,239].map(v=>face('side',0,v,105,porthole)).join('')
      + face('front',10,0,134,range(3,i=>rect(0,7+i*13,53,6,'#7f9299',3))+rect(3,54,41,2,'#c5d5c7'))
      + [15,282].map(u=>face('front',u,0,142,rect(0,0,30,5,'#cce9db',2))).join('')
      + range(4,i=>tile(276,180+i*15,33,3,.7,'#b0c7c3'));
  }

  function volcano() {
    // A jagged basalt opening looks across the caldera. The tiny lectern faces the lava.
    const opening = 'M0 25l20-17 34 5 27-11 34 7 32-7 27 5 34-5 21 12 29-6 17 19-4 51-42 7-44-3-36 6-42-7-42 4-31-8-33 2z';
    const caldera = traced(opening,'#513c4c','#795864',6)
      + '<defs><clipPath id="room-caldera"><path d="'+opening+'"/></clipPath></defs><g clip-path="url(#room-caldera)">'
      + rect(0,0,277,90,'url(#room-lava-sky)')
      + traced('M0 50l21-12 24 9 26-21 20 15 15-13 15 10 30-27 12 2 17 21 21-7 26 13 24-16 34 21v48H0Z','#594451','none')
      + traced('M0 59l39-9 41 6 77-44 7 2 32 34 28 4 18-9 41 17v24H0Z','#694b51','none')
      + traced('M159 15l-14 15 6 3-29 12 5 6-35 11 58 4-19 8 94 9','none','#e9865c',6.6)
      + traced('M159 15l-14 15 5 3-29 13 4 4-32 12 58 3-19 9 92 9','none','#ffd388',2)
      + '</g>';
    const ribs = range(7,i=>{const h=[54,79,67,97,65,81,55][i];return block(3,95+i*20,0,14,18,h,['#756071','#554653','#433b49']);});
    const lectern = feetShadow(268,213,34,23)+block(264,212,0,38,28,4,['#9c7774','#74586a','#574955'])
      + block(279,223,4,8,7,24,walnut)+block(270,217,28,26,16,3,['#ca9572','#a47369','#79565b'])
      + tile(274,219,12,9,31.2,'#e2c6a2') + at(traced('M0 0q-2-8 5-12l2-1','none','#424452',1.6)+ellipse(7,-13,3,1.7,'#605c67'),289,221,32);
    return face('front',24,0,137,caldera) + ribs + lectern
      + face('side',0,273,124,traced('M0 2l35 14-9 14 32 21-11 12','none','#e49b71',2.2))
      + at(ellipse(0,-20,26,13,'#d3816736')+traced('M-8-25l4-14 4 7 4-14 4 21z','#e89a66','none')
        + traced('M-9-23h18l-5 7h-8z','#bc8e76','#795b62',1)+rect(-2,-16,4,16,'#7b6267'),18,252);
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
  // Paired computing spires share a copper backplane and a low service console.
  function exascale() {
    const copper = ['#e4ad85', '#c38370', '#8c5e64'];
    const ceramic = ['#e4d6bd', '#aaa69c', '#778a8e'];
    let art = block(0,0,0,48,28,4,metal);
    function spire(u, height) {
      let s = block(u,1,4,16,16,height,ceramic);
      s += face('front',u+1,17.2,height+2,
        rect(1,1,12,height-5,'#3c555e',1)
        + range(5, i => rect(2,5+i*6,10,2.2,i%2 ? '#77bfb9' : '#c0ddd0',.6)));
      for (const z of [12, height-3]) s += block(u-.5,.5,z,17,17,2,copper);
      return s;
    }
    art += spire(3,38) + spire(29,53)
      + block(1,0,37,8,6,4,copper) + block(9,0,37,24,6,4,copper)
      + block(1,19,4,46,8,8,ceramic)
      + tile(4,20,39,5,12.2,'#384f60')
      + range(6, i => tile(6+i*5,21,3,2.5,12.4,i<4 ? '#a3e3cb' : '#dcab76'));
    return art;
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

  const studios = {
    basement: { draw: basement, rug: ['#916c69', '#c49b85'] },
    warehouse: { draw: warehouse, rug: ['#68838e', '#acb7a5'] },
    office: { draw: office, rug: ['#9c726e', '#d4ae88'] },
    mall: { draw: mall, rug: ['#a17b86', '#c5a7a1'] },
    dam: { draw: dam, rug: ['#6b8980', '#c7bb8e'] },
    penthouse: { draw: penthouse, rug: ['#927b78', '#dac1a2'] },
    bunker: { draw: bunker, rug: ['#697768', '#b5af8c'] },
    orbital: { draw: orbital, rug: ['#7c8f9f', '#c1d3cd'] },
    volcano: { draw: volcano, rug: ['#785765', '#ba9179'] },
  };
  // Illustration masters for the room and the collection. Printed lettering is
  // drawn as strokes so snapshots and tiny thumbnails never require a font.
  const ink = '#534857', paper = '#f6dfb1', brass = '#d69c66', jade = '#659c8c';
  const silhouette = (d, fill, outline = ink, pen = 1.7) => traced(d, fill, outline, pen);
  const stroke = (d, color = ink, pen = 1.7) => traced(d, 'none', color, pen);
  const letters = {
    A:'M0 5l2-5 2 5M1 3h2', B:'M0 5V0h2q3 1 0 2.5q3 1.5 0 2.5Z',
    C:'M4 1Q0-2 0 2.5T4 4', D:'M0 0v5h1q5-2.5 0-5Z', E:'M4 0H0v5h4M0 2.5h3',
    F:'M0 5V0h4M0 2.5h3', G:'M4 1Q0-2 0 2.5T4 4V3H2', H:'M0 0v5M4 0v5M0 2.5h4',
    I:'M0 0h4M2 0v5M0 5h4', K:'M0 0v5M4 0L0 3l4 2', L:'M0 0v5h4',
    M:'M0 5V0l2 3 2-3v5', N:'M0 5V0l4 5V0', O:'M2 0q2 0 2 2.5T2 5T0 2.5T2 0Z',
    P:'M0 5V0h2q4 1.5 0 3H0', R:'M0 5V0h2q4 1.5 0 3H0m2 0 2 2', S:'M4 .5Q0-1 0 1.5q0 1 2 1t2 1.5q0 2-4 .5',
    T:'M0 0h4M2 0v5', U:'M0 0v3q0 2 2 2t2-2V0', V:'M0 0l2 5 2-5', Y:'M0 0l2 2.5L4 0M2 2.5V5',
  };
  function printInk(word,x,y,scale,color) {
    return group([...word].map((ch,i)=>letters[ch] ? group(stroke(letters[ch], color, .9), 'translate('+(i*6)+' 0)') : '').join(''),
      'translate('+x+' '+y+') scale('+scale+')');
  }

  const printArt = {
    'hang-cat': () => rect(0,0,58,69,'#e5c797') + rect(3,3,52,51,'#9cb79a')
      + ellipse(43,15,8,8,'#edc77e') + stroke('M2 11Q21 16 54 9','#67594f',3)
      + stroke('M48 11l3-5m-5 5-2-4','#67594f',1.6)
      + silhouette('M21 29l1-8 5 4 7-1 5-5 0 10q4 5-2 10l-1 6 2 4q-4 4-7-2l-3-1-2 4q-4 0-4-4l1-7q-5-3-2-10z','#cf875f')
      + stroke('M23 26l-2-13m14 11 1-12','#e4a979',4) + stroke('M35 40q12 0 10-9q0-4 3-2q5 12-10 15','#bb7658',3)
      + ellipse(26,29,1.2,1.3,ink)+ellipse(34,28,1.2,1.3,ink)+stroke('M28 32l2 1 2-2','#704e53',1)
      + printInk('HANG IN',8,56,.88,ink)+printInk('THERE',14,63,.72,ink),
    disrupt: () => rect(0,0,58,69,'#244d59') + ellipse(29,25,15,15,'#d7856b')
      + silhouette('M9 48l16-23 3 8 12-18-5 21 14-3-28 20 5-14Z','#e7ba79','none')
      + stroke('M6 49l15-20m17-14 6-6m-6 13 7-6','#9ec1a8',1.5) + printInk('DISRUPT',5,58,1.18,paper),
    blueprint: () => rect(0,0,58,69,'#4d7089')
      + range(7,i=>line(4+i*8,3,4+i*8,64,'#69889a',.5)) + range(8,i=>line(3,4+i*8,55,4+i*8,'#69889a',.5))
      + stroke('M10 43l14-19 17 3 7 14-15 8-23-6Zm14-19 9 25m-15-18 17 3m3-6 4 9m-32 12h36m-35-2v4m34-4v4','#cde1d5',1.5)
      + printInk('PLAN B',7,56,.92,paper),
    bootstraps: () => rect(0,0,58,69,'#d49378') + ellipse(28,27,19,19,'#ebbb83')
      + silhouette('M17 14l11-3 6 18q1 4 8 4l5 4v6q-16 6-34 0v-6l8-5Z','#6d605d')
      + stroke('M15 41q14 5 31-2','#dba97c',2.6)+stroke('M25 18l7-2m-6 7 8-2m-6 7 7-2',paper,1.8)
      + printInk('BOOT UP',6,57,1.04,ink),
  };

  const propArt = {
    'debug-duck': () => silhouette('M-24-15q5 6 13 4q-4-12 4-18q11-8 18 3q4 6 0 12q13 2 11 9q-3 11-23 9q-21-1-23-19Z','#e8b956')
      + silhouette('M8-19q6 2 15 0q-3 7-14 6Z','#dc8961')+ellipse(6,-23,1.9,2.4,ink)
      + silhouette('M-13-9q7-5 16-1q-6 8-15 4Z','#d7a14e','none') + ellipse(-3,-27,3,1.6,'#f8d883'),
    'stress-ball': () => ellipse(0,-1,16,4,'#44374a38') + ellipse(0,-13,18,16,'#cb8d79') + ellipse(-4,-17,12,10,'#e3a38b')
      + stroke('M-6-16l4 1m6-1 3-2m-8 7q4 2 7-1','#6f595d',2) + stroke('M10-25l3 2','#eed0a2',2),
    'ceo-mug': () => ellipse(0,-1,18,4,'#44374a38') + silhouette('M12-23q19-3 15 9q-2 8-16 7l1-4q9 1 11-5q2-5-10-3Z',brass)
      + silhouette('M-16-26q12-5 30-1l-2 24q-12 6-25-1Z','#eac89c') + ellipse(-1,-26,15,4,'#f8e0b7') + ellipse(-1,-26,12,2.5,'#72514b')
      + printInk('CEO',-10,-18,.93,'#755b59') + stroke('M-9-9q9 3 18 0','#a6856c',1),
    clipboard: () => silhouette('M-20-9l27-21 16 12L-3 3Z','#9b7260') + silhouette('M-16-10L7-27l12 9L-4 0Z','#eddbad','none')
      + silhouette('M1-24l8-6 6 4-8 6Z','#829a95') + stroke('M-8-11l3 1 4-5m1 4 8-6m-8 12 11-8','#708779',1.5),
    cactus: () => group(rect(-9,-35,18,26,'#58947d',8)+stroke('M-7-19q-13 4-13-11m26 15q13 0 12-16','#58947d',8)
      +stroke('M-2-29v18m7-17v14M-19-27l1 5','#a6c291',1.4)+ellipse(6,-35,4,3,'#e5a080')
      +silhouette('M-12-12h25l-4 14q-9 3-17-1Z','#c48868')+rect(-14,-14,28,5,'#dfa580',1),'translate(0 -2)'),
    ficus: () => stroke('M-1-15q2-13 0-27m1 16-12-9m13 6 11-11','#836f57',2.6)
      +[[-14,-34,-24],[14,-40,-30],[0,-47,-53],[-14,-44,-20],[11,-30,-29]].map(([x,y,r],i)=>group(ellipse(0,0,10,5.7,i%2?'#60947a':'#86ab86')+line(-6,1,4,0,'#a6c499',.8),'translate('+x+' '+y+') rotate('+r+')')).join('')
      +silhouette('M-13-16h26l-4 17q-9 4-18-1Z','#a7b4a7')+ellipse(0,-16,13,3,'#657c69')+stroke('M-8-9l1 5','#d8d8ba',2),
    tomato: () => stroke('M-1-2V-53','#a58464',2)+stroke('M-6-12q14-18 0-33m9 18 10-8m-13-3-12-7','#638870',3)
      +[[-12,-37],[13,-33],[-2,-44],[-6,-23],[1,-15]].map(([x,y],i)=>group(ellipse(0,0,7,3,i%2?'#77a57b':'#527f67'),'translate('+x+' '+y+') rotate(-28)')).join('')
      +[[-10,-29],[8,-20],[5,-36]].map(([x,y])=>ellipse(x,y,5,4.5,'#d77f66')+stroke('M'+(x-2)+' '+(y-4)+'l3 2 2-3','#557563',1.4)).join('')
      +silhouette('M-15-10h30l-4 11h-22Z','#b87762')+rect(-16,-13,32,5,'#d39470',1),
    'fairy-lights': () => stroke('M-27-32q23 26 54 0','#66575d',2.2)
      +[[-21,-26],[-12,-21],[-1,-19],[11,-20],[22,-26]].map(([x,y],i)=>line(x,y,x,y+5,ink,1.6)+ellipse(x,y+6,5,5,'#f7c98345')+ellipse(x,y+6,2.5,3.8,i%2?'#f5be83':'#f4daa0')).join('')
      +ellipse(-27,-32,2,2,brass)+ellipse(27,-32,2,2,brass),
    'lava-lamp': () => ellipse(0,0,13,3,'#49354135')+silhouette('M-8-44h16l5 27-6 10H-7l-6-10Z','#c399a7')
      + silhouette('M-9-18q4-11 8-6q9-3 10 2l-4 10H-5Z','#ed9c64','none')+ellipse(2,-32,3.8,6,'#f2b374')+ellipse(-5,-36,2.3,2,'#f2b374')
      +silhouette('M-8-44l3-5H5l3 5Z','#aab2a4')+silhouette('M-7-10H7l5 9q-11 5-24 0Z','#879399')+stroke('M-8-37l-2 9','#edd0c2',1.5),
    chandelier: () => stroke('M0-53v21m-19 5q0 13 19 8q19 4 19-8m-32 9 3 9m19-9-3 9','#c29564',2.4)
      +silhouette('M0-34l5 8-5 7-5-7Z','#b6cdc1')+[[-19,-29],[19,-29],[-10,-9],[9,-9],[0,-15]].map(([x,y])=>silhouette('M'+x+' '+(y-5)+'l3 5-3 5-3-5Z','#e9d5a7','#b99874',1)).join(''),
    'alarm-beacon': () => ellipse(0,-1,15,4,'#756d79')+rect(-15,-8,30,7,'#7c8285',2)+silhouette('M-12-8v-14q0-13 12-13t12 13v14Z','#d8876d')
      +stroke('M-7-24q0-5 5-6','#f4c599',2.7)+rect(-12,-11,24,3,'#a26766')+stroke('M-20-28l-5-3m45 3 5-3M0-42v-4','#d7aa7d',1.5),
    'paper-rocket': () => silhouette('M-13-8l8-24q3-10 10-16l7 4q3 17-3 32L1-4Z','#e8d0a1')
      +silhouette('M-4-29l14 5 1-6-13-5Z','#bf7c69','none')+ellipse(2,-20,4,4,'#729ca1')
      +silhouette('M-11-17l-9 8 1 11 9-11m16 0 4 12 4-12-4-8','#c5836a')+stroke('M-4-3l-2 6m6-5-2 7',brass,2),
    'ice-tray': () => silhouette('M-24-9l27-11 22 6-28 13Z','#a4cecb')+silhouette('M-24-9l21 8v5l-20-7Z','#6b9caa')+silhouette('M-3-1l28-13-1 7L-3 5Z','#537f96')
      +range(3,i=>range(2,j=>{const x=-16+i*8+j*7,y=-9-i*3+j*3;return silhouette('M'+x+' '+y+'l5-2 5 1-5 3Z','#e4e8d7','#74a3af',1);})),
    mannequin: () => ellipse(0,1,13,3,'#786775')+line(0,0,0,-21,'#99785d',2.7)+silhouette('M-3-40h6v4l9 4-4 8q-4 3 0 10l-2 4h-13l-1-4q5-8 1-11l-4-7 8-4Z','#d8b495')
      +stroke('M-1-34l3 5-2 15','#ba947a',1.2)+silhouette('M-11-32l6 3 5 11 6-15 5 3-7 21H-5Z','#8baca0', '#688e87',1.2),
    'snow-globe': () => silhouette('M-11-9q-15-10-6-23q7-10 18-7q16 3 16 17q0 9-9 14Z','#afd1cb')
      +silhouette('M-15-16l11-13 4 7 5-3 10 12-13 4Z','#668e91','none')+silhouette('M-9-23l5-6 4 7-5-2Z',paper,'none')
      +stroke('M-12-27q3-6 9-7','#e3ead5',1.8)+ellipse(9,-29,1.2,1.2,paper)+ellipse(3,-18,1.2,1.2,paper)
      +silhouette('M-12-10l24 0 4 9q-15 5-31-1Z','#b98162')+rect(-6,-5,12,2,brass),
    radio: () => line(4,-18,17,-41,'#9c9b8f',1.4)+ellipse(17,-41,1.5,1.5,'#d8c4a6')
      +silhouette('M-20-25q0-3 3-4l32-2 6 4v26l-37 2-4-3Z','#ad7f65')
      +silhouette('M-16-25l33-2v21l-33 2Z','#c39571','#9c755f',1)+rect(-13,-22,16,14,'#716965',2)
      +range(4,i=>line(-11,-20+i*3,1,-20+i*3,'#a48c71',1))+rect(6,-23,9,5,'#d7cdae',1)
      +ellipse(8,-11,2.7,2.7,'#645c62')+ellipse(14,-11,2,2,'#645c62'),
    satellite: () => line(0,0,1,-15,ink,2)+ellipse(0,1,13,3.4,'#7e8790')
      +stroke('M-15-20l29-5',brass,3)+silhouette('M-24-21l13-4 6 11-13 4Z','#759da8')+silhouette('M9-27l14-4 5 10-14 4Z','#779cae')
      +stroke('M-20-17l13-4m18-2 14-4m-42 3 5 11m29-15 5 10','#b2d5cd',1.1)
      +silhouette('M-6-25l8-4 8 5-2 10-7 3-6-5Z','#dbb276')+silhouette('M-9-37q11 1 16 10q-12 5-16-10Z','#c1cbbd')+line(-6,-34,-10,-41,'#a6b9b3',1.6),
  };


  // These patterns are painted flat and projected onto the floor as a single
  // textile, so the hems and pile meet the workbench feet at every location.
  const fabrics = {
    'rag-rug': () => {
      const yarn=['#d39b80','#b97267','#e5be94','#6c9791','#96b0a1','#c69171','#856878'];
      return rect(0,0,100,80,'#bc927b',2)
        + range(22,i=>rect(2,2+i*3.45,96,2.6,yarn[i%yarn.length],1))
        + range(13,i=>line(3+i*7.7,4,3+i*7.7,76,'#f1d4a832',.85))
        + range(22,i=>line(1,2+i*3.55,-2,3+i*3.55,'#d2b099',1.1)+line(99,2+i*3.55,102,1+i*3.55,'#d2b099',1.1));
    },
    'chair-mat': () => silhouette('M14 1h72l12 12v54L85 79H15L2 66V14Z','#787887','#4c545f',2)
      +stroke('M14 8h70l7 9v46l-9 9H17L9 64V18Z','#ca9379',2)
      +stroke('M31 48q6-16 17-18q17-2 19 16m-36 2 14 8 22-10m-19-16 3 22','#acada9',2)
      +ellipse(48,41,6,4,'#c99c82'),
    'circuit-rug': () => rect(0,0,100,80,'#527471',2)+rect(3,3,94,74,'#71938a',1)
      +[0,1,2,3].map(i=>stroke('M7 '+(12+i*12)+'h'+(18+i*2)+'l9 9h9m49 '+(-17+i*2)+'H73l-8 8h-9','#c9b68b',1.5)).join('')
      +range(4,i=>ellipse(43,21+i*12,2,2,'#dfc699')+ellipse(56,19+i*12,2,2,'#dfc699'))
      +stroke('M37 26h26v29H37Z','#446a69',2)+stroke('M42 31h16v19H42Z','#d3be91',1.4),
    'singed-rug': () => silhouette('M2 2h96v23l-5 7 3 6-5 9 7 5v25H1V59l5-5-5-9Z','#aa796c','#69555a',2)
      +stroke('M7 7h85v11m0 40v12H8V59m0-18V12','#dcaa84',2.5)
      +silhouette('M96 24l-12 9 3 5-9 7 7 8 13 7v-9l-6-5 5-9-3-6Z','#695858','none')
      +stroke('M80 50l-11 9m9-16-10 4m14-11-10-2','#84645e',2.2),
  };

  // Panorama masters are wider than a thumbnail. The same illustration is
  // cropped to each room's own frame; shutters and mullions sit in front.
  function neighborhood() {
    let art=rect(0,0,144,68,'#c9d6bb')+ellipse(27,16,8,8,'#f5d098')
      +silhouette('M0 36q18-20 43-8t55-1t46 4v37H0Z','#8eafa0','none')
      +silhouette('M0 41q29-9 52-3t45-2t47 4v28H0Z','#709282','none');
    for(const [x,y,c] of [[9,43,'#d8b28e'],[34,40,'#d7c6a0'],[65,46,'#e2bd92'],[94,40,'#c7a392'],[119,45,'#e3c392']]){
      art+=rect(x,y,16,15,c)+silhouette('M'+(x-3)+' '+y+'l11-9 11 9Z','#a8786c','none')
        +rect(x+3,y+4,4,5,'#607981')+rect(x+10,y+6,3,9,'#8d6d64');
    }
    return art+silhouette('M0 60q35-4 67-1t77-2v11H0Z','#acb292','none')+stroke('M0 64q33-4 64-1t80-3','#e5ceaa',2);
  }
  function skylineView() {
    let art=rect(0,0,144,68,'#8787a1')+rect(0,29,144,39,'#c9979c')+ellipse(106,22,9,9,'#f1bc96');
    [19,31,25,41,27,16,32,46,24,35,21,18].forEach((h,i)=>{
      const x=i*12, y=68-h;
      art+=rect(x,y,11,h,i%2?'#575b74':'#687186')
        +range(Math.floor((h-4)/6),j=>rect(x+2,y+3+j*6,2.2,2.6,i%3?'#dfbb94':'#a5bfbe')+rect(x+7,y+3+j*6,2.2,2.6,'#d3b49b'));
    });
    return art+line(90,23,90,15,'#605e74',1.5);
  }
  function winterView(){
    return rect(0,0,144,68,'#a3c2ce')+ellipse(105,13,7,7,'#eae2c3')
      +silhouette('M0 40l23-22 16 13 21-23 26 29 17-12 20 12 21-15v40H0Z','#889eae','none')
      +silhouette('M44 25L60 8l14 16-10-3-6 4-3-5Z','#e8e6d9','none')
      +silhouette('M0 53q30-15 61-9t83-4v28H0Z','#e2e7d9','none')
      +[8,18,36,91,118,135].map((x,i)=>group(silhouette('M0 0l-6 12h3l-5 9H7l-4-9h3Z','#688986','none'),'translate('+x+' '+(37-i%3*3)+')')).join('')
      +range(17,i=>ellipse((i*41+6)%144,(i*19+2)%43,1,1,'#f3efd9'));
  }
  function spaceView() {
    return rect(0,0,144,68,'#394562')+range(30,i=>ellipse((i*31+13)%144,(i*17+7)%68,i%3?.7:1.2,i%3?.7:1.2,'#e3d4b4'))
      +ellipse(97,25,12,12,'#d49787')+group('<ellipse cx="0" cy="0" rx="21" ry="3.8" fill="none" stroke="#eec698" stroke-width="2"/>','translate(97 25) rotate(-21)')
      +silhouette('M-4 69q33-37 81 1Z','#81a9ad','#bfd2c4',2)+stroke('M10 61l9-4 8 1 8-5','#a0beb1',2);
  }
  function calderaView() {
    return rect(0,0,144,68,'#c18c89')+ellipse(27,15,7,7,'#ebbb8b')
      +silhouette('M0 40l17-12 19 7 14-16 19 15 16-9 13 7 14-10 32 13v33H0Z','#8c6874','none')
      +silhouette('M0 52l34-12 21 3 27-29 6-1 26 27 30 6v22H0Z','#665968','none')
      +stroke('M86 17l-7 11 4 3-15 8 3 3-17 8 30 3-6 5 21 5','#df986a',4.5)
      +stroke('M86 17l-7 11 4 3-15 8 3 3-17 8 30 3-6 5 21 5','#f7c68a',1.3);
  }
  const views = {suburbs:neighborhood, skyline:skylineView, snowfall:winterView, starfield:spaceView, caldera:calderaView};
  const masterView = {
    poster:'-5 -5 68 79',desk:'-32 -40 65 50',plant:'-32 -58 64 67',
    rug:'-5 -5 110 90',lamp:'-34 -59 68 69',window:'0 0 144 68',shelf:'-33 -52 66 62',
  };
  function illustration(id) {
    const paint = printArt[id] || propArt[id] || fabrics[id] || views[id];
    return paint ? paint() : '';
  }
  function thumbnail(id) {
    const item = window.Economy.DECORATIONS.find(item => item.id === id);
    if (!item) return '';
    return '<svg xmlns="'+svgNS+'" aria-hidden="true" focusable="false" viewBox="'+masterView[item.slot]+'">'+illustration(id)+'</svg>';
  }

  const sideWall = (axis, height) => ({side:'side', u:0, v:axis, height});
  const backWall = (axis, height) => ({side:'front', u:axis, v:0, height});
  // The wide rooms use their real exterior glass. In the two enclosed rooms
  // the same print slides into a backlit picture frame on the interior wall.
  const roomFittings = {
    basement: {poster:sideWall(179,144),window:sideWall(265,124),pane:[73,24],shelf:backWall(245,105),lamp:backWall(33,137)},
    warehouse:{poster:backWall(257,134),window:backWall(132,122),pane:[102,40],shelf:backWall(48,98),lamp:sideWall(110,143)},
    office:   {poster:sideWall(243,123),window:backWall(104,127),pane:[190,76],shelf:sideWall(113,84),lamp:backWall(35,137)},
    mall:     {poster:backWall(263,126),window:sideWall(158,128),pane:[79,42],shelf:sideWall(272,117),lamp:backWall(121,142),interior:true},
    dam:      {poster:sideWall(80,141),window:backWall(39,134),pane:[252,72],shelf:sideWall(274,91),lamp:backWall(309,141)},
    penthouse:{poster:backWall(275,134),window:backWall(7,135),pane:[250,86],shelf:sideWall(193,99),lamp:sideWall(273,142)},
    bunker:   {poster:sideWall(276,119),window:backWall(173,121),pane:[94,51],shelf:backWall(293,101),lamp:sideWall(90,142),interior:true},
    orbital:  {poster:backWall(291,129),window:backWall(96,131),pane:[190,72],shelf:sideWall(79,88),lamp:sideWall(269,143)},
    volcano:  {poster:sideWall(277,138),window:backWall(24,137),pane:[277,90],shelf:sideWall(77,83),lamp:backWall(308,140)},
  };
  function surface(anchor,paint) {
    return face(anchor.side,anchor.u,anchor.v,anchor.height,paint);
  }
  function mountedProp(anchor, paint, scale, down = 0) {
    return at(paint,anchor.u+2,anchor.v+2,anchor.height-down,scale);
  }
  function shelfBoard(anchor,span) {
    const diagonal=anchor.side==='side';
    const u=anchor.u, v=anchor.v, z=anchor.height;
    const w=diagonal?12:span, d=diagonal?span:12;
    const left=diagonal?u:u-span/2, top=diagonal?v-span/2:v;
    return block(left,top,z-3,w,d,3,wood)
      +block(left+2,top+2,z-8,4,4,5,walnut)+block(left+w-6,top+d-6,z-8,4,4,5,walnut);
  }
  function landscape(loc,id) {
    const f=roomFittings[loc], [w,h]=f.pane;
    const scene='<svg width="'+w+'" height="'+h+'" viewBox="0 0 144 68" preserveAspectRatio="xMidYMid slice">'+views[id]()+'</svg>';
    let glass=scene;
    if(loc==='orbital') glass='<g clip-path="url(#room-cupola)">'+scene+stroke('M36 0l15 24v35L39 74 M156 0l-14 23v33l16 18','#82909d',4)+'</g>';
    else if(loc==='volcano') glass='<g clip-path="url(#room-caldera)">'+scene+'</g>';
    else if(f.interior) glass=windowFrame(w,h,'#495860')+scene+rect(2,h-3,w-4,2,'#bba888');
    else if(loc==='office'||loc==='penthouse'){
      const step=loc==='office'?48:43;
      for(let x=0;x<w;x+=step)glass+=rect(x,0,2.8,h,'#635c67');
      if(loc==='office')glass+=rect(0,25,w,2,'#6f6470');
    } else if(loc==='dam')glass+=rect(0,31,w,2,'#d7e2ca');
    else glass+=rect(w/2-1.5,0,3,h,'#625f6c');
    return surface(f.window,glass);
  }

  function floorTextile(id) {
    const [x,y]=floorPoint(47,145,.75);
    return group(fabrics[id](),'matrix(1.224 .5304 -1.176 .588 '+x+' '+y+')');
  }
  function posterAt(loc,id) {
    const scale=loc==='orbital'?.63:.84;
    return surface(roomFittings[loc].poster,group(rect(1.5,2.5,59,70,'#493d512e',1)
      +rect(-1.5,-1.5,61,72,'#7c6664',1)+printArt[id]()
      +rect(-.5,-.5,59,1.3,'#e6c5a3')+rect(.8,1.4,3,2,'#fae4bc',.6)+rect(54,1.4,3,2,'#fae4bc',.6),'scale('+scale+')'));
  }
  function lightAt(loc,id) {
    const anchor=roomFittings[loc].lamp;
    if(id==='fairy-lights') return surface(anchor,group(propArt[id](),'translate(0 30) scale(.75)'));
    if(id==='chandelier') return surface(anchor,ellipse(0,2,4.4,2,'#847577'))+mountedProp(anchor,propArt[id](),.85,46);
    const board={...anchor,height:anchor.height-41};
    return shelfBoard(board,24)+mountedProp(board,propArt[id](),.68);
  }
  // Bake the sRGB light into the pigments when a look is selected. Ambient
  // equipment updates can then repaint the room without any SVG filter surfaces.
  const roomTones = {
    basement:[1,.96,.91], warehouse:[.91,.98,1], office:[1,.95,.94],
    mall:[1,.95,.98], dam:[.94,.99,.93], penthouse:[1,.97,.92],
    bunker:[.91,.94,.84], orbital:[.93,.99,1], volcano:[1,.88,.83],
  };
  function decorLayer(loc,slot,id,art) {
    const tone=roomTones[loc];
    const lit=art.replace(/((?:fill|stroke)="#)([0-9a-f]{6})([0-9a-f]{2})?"/gi, (original,prefix,rgb,alpha='') => {
      const value=parseInt(rgb,16);
      const r=Math.round((value>>>16)*tone[0]);
      const g=Math.round(((value>>>8)&255)*tone[1]);
      const b=Math.round((value&255)*tone[2]);
      return prefix+((r<<16)|(g<<8)|b).toString(16).padStart(6,'0')+alpha+'"';
    });
    return '<g data-decor-slot-art="'+slot+'" data-decor-item="'+id+'">'+lit+'</g>';
  }

  const slotNames={poster:'Wall poster',desk:'Desk item',plant:'Plant corner',rug:'Rug',lamp:'Lamp',window:'Window view',shelf:'Shelf item'};
  const markerPaths={
    poster:'M-6-7H6V7H-6ZM-4 4l3-4 2 2 2-3',
    desk:'M-6-4h9v7q-4 4-9 0Zm9 1q8-1 4 5H3',
    plant:'M-4 2h8L3 7h-6ZM0 2v-8m0 6q-7 0-6-5q6 0 6 5Zm0-3q1-5 6-4q1 4-6 5',
    rug:'M-7-4H7v8H-7Zm-2 0v8M9-4v8m-13-5h8',
    lamp:'M-4-7h8l3 8H-7Zm4 8v5m-4 1h8',
    window:'M-7-6H7V6H-7ZM0-6V6m-7-7H7',
    shelf:'M-8 5H8M-6 1v-7h3v7Zm6 0v-6l3-1 2 6Z',
  };
  function targetAnchors(loc,equipped) {
    const {poster,window:win,pane:[w,h],shelf,lamp:lightSlot}=roomFittings[loc];
    function faceCenter(a,x,y) {
      const offset=a.side==='front'?[x,0]:[0,-x];
      return floorPoint(a.u+offset[0],a.v+offset[1],a.height-y);
    }
    return {
      poster:faceCenter(poster,20,27), desk:floorPoint(139,207,45),
      plant:floorPoint(301,265,20), rug:floorPoint(92,249,0),
      lamp:faceCenter(lightSlot,0,equipped.lamp==='fairy-lights'?10:24),
      window:faceCenter(win,w/2,h/2), shelf:floorPoint(shelf.u,shelf.v,shelf.height+10),
    };
  }


  // Clip only overlapping touch areas to the halfway line between their pins.
  // In a short phone room, tapping a visible pin must always select that slot.
  function slotHitPolygon(slot, anchors, radius) {
    let corners=[[-radius,-radius],[radius,-radius],[radius,radius],[-radius,radius]];
    const [x,y]=anchors[slot];
    for (const [other,[ox,oy]] of Object.entries(anchors)) {
      if (other===slot) continue;
      const dx=ox-x,dy=oy-y, halfway=(dx*dx+dy*dy)/2;
      const distance=([a,b]) => a*dx+b*dy-halfway;
      let clipped=[],prev=corners[corners.length-1], previous=distance(prev);
      for (const point of corners) {
        const current=distance(point);
        if ((previous<=0)!==(current<=0)) {
          const t=previous/(previous-current);
          clipped.push([prev[0]+t*(point[0]-prev[0]),prev[1]+t*(point[1]-prev[1])]);
        }
        if (current<=0) clipped.push(point);
        prev=point; previous=current;
      }
      corners=clipped;
    }
    return points(corners.map(p=>p.map(round)));
  }

  function studio(loc, decor){
    const {draw, rug} = studios[loc];
    const fittings = roomFittings[loc];
    let art = shell(loc) + draw();
    if (decor.window) art += decorLayer(loc,'window',decor.window,landscape(loc,decor.window));
    if (decor.poster) art += decorLayer(loc,'poster',decor.poster,posterAt(loc,decor.poster));
    if (decor.shelf) {
      const board = loc==='basement' || loc==='office' ? '' : shelfBoard(fittings.shelf,29);
      art += decorLayer(loc,'shelf',decor.shelf,board + mountedProp(fittings.shelf,propArt[decor.shelf](),.64));
    }
    if (decor.lamp) art += decorLayer(loc,'lamp',decor.lamp,lightAt(loc,decor.lamp));
    // Cable trays, a low-pile rug and a workbench give a fresh room a place to begin.
    art+=decor.rug ? decorLayer(loc,'rug',decor.rug,floorTextile(decor.rug)) : tile(47,145,136,112,.6,rug[0])+tile(50,148,130,2,.7,rug[1])+tile(50,251,130,2,.7,rug[1])
      +tile(50,149,2,102,.7,rug[1])+tile(178,149,2,102,.7,rug[1]);
    art+=ground(76,162,76,42,1.2,2.1,'#594f58')+ground(76,42,166,42,1.2,2.1,'#594f58')+ground(166,42,166,7,1.2,2.1,'#594f58')
      +bench(54,174,94,40,33)+carton(64,182,0,19,14,15)
      +tile(127,181,13,13,37.3,'#e0cfb2')+tile(129,183,9,1,37.4,'#a1948c')
      +(decor.desk ? decorLayer(loc,'desk',decor.desk,at(propArt[decor.desk](),140,207,37.5,.54)) : at(rect(-2,-4,4,4,'#cc9077',.7)+ellipse(0,-4,2.3,1,'#f4cda1')+traced('M2 -4q4 0 2 2','none','#c88973',1),141,179,37));
    if(loc==='basement')art+=carton(275,210,0,29,30,21)+carton(277,213,21,20,21,15)+carton(296,243,0,16,17,12);
    else if(loc==='warehouse')art+=carton(277,219,0,29,25,20)+carton(276,244,0,20,17,19);
    else if(loc==='office' && !decor.plant)art+=plant(295,234,1.3);
    else if(loc==='mall')art+=carton(294,239,0,18,19,12);
    if (decor.plant) art+=decorLayer(loc,'plant',decor.plant,at(ellipse(1,1,13,4,'#352a3d35')+propArt[decor.plant](),301,265,0,1.04));
    return art;
  }
  const spriteArt={laptop,tower,rack,gpu,cluster,mainframe,exascale,fan,ac,liquid,
    sibling:()=>worker('sibling'),sysadmin:()=>worker('sysadmin'),manager:()=>worker('manager')};
  // Coordinates are permanent parking spots. New purchases never shuffle another stack.
  const slots={
    ac:[[4,178,83]],rack:[[79,27],[116,27]],gpu:[[125,83],[171,83]],
    cluster:[[186,17],[233,17]],mainframe:[[286,40]],exascale:[[236,94]],
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
      '<linearGradient id="room-penthouse-dusk" x2="0" y2="1"><stop stop-color="#b7abb9"/><stop offset=".65" stop-color="#ecc5a7"/><stop offset="1" stop-color="#dfa485"/></linearGradient>'+
      '<linearGradient id="room-lava-sky" x2="0" y2="1"><stop stop-color="#735669"/><stop offset=".7" stop-color="#dc916e"/><stop offset="1" stop-color="#f2bc86"/></linearGradient>'+
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
      if(!event.isPrimary || svg.classList.contains('doll-decorating')) return;
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
    const targets=create('g',{class:'doll-decor-targets'});
    svg.append(clutter,things,badges,targets);
    const circuit=document.createElement('div');
    circuit.className='doll-lights';circuit.setAttribute('aria-hidden','true');
    const haze=document.createElement('span');
    haze.className='doll-local-haze';haze.setAttribute('aria-hidden','true');
    frame.append(scenery,svg,circuit,haze);
    container.replaceChildren(frame);
    enableRoomDrag(container,frame);
    // The dense room and machine paths stay on static surfaces. Only the small
    // indicator, fan and haze accents need to change while the room is running.
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
    const indicatorPositions={rack:[22,28,57],cluster:[7,31,58],mainframe:[15,31,12],exascale:[37,17,49],tower:[12,25,15],laptop:[6,4,12],gpu:[8,24,7],fan:[11,11.2,14]};
    let signLight;
    let lastLocation='',lastStage=-1;
    let equipped={}, decorKey='', editing=false, selectedSlot=null;
    const markers = new Map();
    const editSize=new ResizeObserver(()=>{ if(editing) updateTargets(lastLocation); });
    function background(loc) {
      let cached=backgrounds.get(loc);
      // Retain one image per location, even after many previews. The image is
      // rasterized once, below the equipment and outside its live update loop.
      if (!cached || cached.key!==decorKey) {
        const image='<svg xmlns="'+svgNS+'" viewBox="-263 -174 587 463">'+defs(false)+studio(loc,equipped)+'</svg>';
        cached={key:decorKey,src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(image)};
        backgrounds.set(loc,cached);
      }
      scenery.src=cached.src;
    }
    function updateTargets(loc) {
      targets.style.display=editing?'':'none';
      if (!editing || !loc) return;
      const anchors=targetAnchors(loc,equipped);
      const scale=svg.getBoundingClientRect().width/587;
      if (scale<=0) return;
      const hitRadius=Math.max(19,22/scale);
      const pinScale=Math.max(.72,Math.min(2.2,.72/scale));
      for (const [slot,[x,y]] of Object.entries(anchors)) {
        let button=markers.get(slot);
        if (!button) {
          button=create('g',{'data-decor-slot':slot,role:'button',tabindex:0,class:'doll-decor-target'});
          const label=create('g',{'pointer-events':'none'});
          label.append(create('rect',{x:-17,y:-14,width:34,height:28,rx:8,class:'doll-decor-ring'}),
            create('circle',{r:10.2,class:'doll-decor-pin'}),create('path',{d:markerPaths[slot],class:'doll-slot-icon'}));
          button.append(create('polygon',{fill:'transparent'}),label);
          button.addEventListener('keydown',event=>{
            if(event.key!=='Enter' && event.key!==' ')return;
            event.preventDefault();event.stopPropagation();
            button.dispatchEvent(new MouseEvent('click',{bubbles:true}));
          });
          targets.append(button); markers.set(slot,button);
        }
        button.firstElementChild.setAttribute('points',slotHitPolygon(slot,anchors,hitRadius));
        button.lastElementChild.setAttribute('transform','scale('+pinScale+')');
        button.setAttribute('aria-label',slot==='window' && roomFittings[loc].interior?'Wall view':slotNames[slot]);
        button.setAttribute('aria-pressed',String(selectedSlot===slot));
        button.setAttribute('transform','translate('+x+' '+y+')');
      }
    }
    function setDecor(choices,open=false,activeSlot=null) {
      const next={};
      for (const entry of window.Economy.DECORATIONS) {
        if (choices?.[entry.slot]===entry.id) next[entry.slot]=entry.id;
      }
      const key=Object.values(next).join('|');
      const changed=key!==decorKey;
      if (!changed && editing===open && selectedSlot===activeSlot)return;
      if (editing!==open) {
        if (open) editSize.observe(svg);
        else editSize.disconnect();
      }
      equipped=next; decorKey=key; editing=open; selectedSlot=activeSlot;
      frame.classList.toggle('doll-decorating',editing);
      svg.setAttribute('role',editing?'group':'img');
      if (changed && lastLocation) background(lastLocation);
      updateTargets(lastLocation);
    }
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
    // Sample small accents on the existing game clock. Running four independent
    // CSS timelines kept the entire room's style tree active between game ticks.
    const room = container.parentElement;
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    const mistLevels = [.25, .5, .8, .55];
    let nextAccentAt = 0, fanPhase = -1, lightsOn = true, mistLevel = -1, signOn = true;

    function updateAccents() {
      const now = performance.now();
      if (now < nextAccentAt) return;
      nextAccentAt = now + 100;
      const still = motionPreference.matches || document.body.classList.contains('effects-reduced') ||
        document.body.classList.contains('effects-paused') || room.classList.contains('outside-view');
      const fanPeriod = parseFloat(room.style.getPropertyValue('--fan-period')) || 1800;
      const fan = groups.get('fan').light;
      if (fan) {
        const step = still ? 0 : Math.floor(now / (fanPeriod / 12)) % 12;
        if (fanPhase !== step) {
          fan.firstElementChild.style.transform = 'rotate(' + step * 30 + 'deg)';
          fanPhase = step;
        }
      } else fanPhase = -1;

      const blinkPeriod = fanPeriod + 1000;
      const lit = still || now % blinkPeriod < blinkPeriod * .8;
      if (lit !== lightsOn) {
        circuit.style.opacity = lit ? '1' : '.48';
        lightsOn = lit;
      }
      if (signLight) {
        const neonLit = still || now % 9000 < 8400;
        if (neonLit !== signOn) {
          signLight.style.opacity = neonLit ? '1' : '.44';
          signOn = neonLit;
        }
      }
      if (!still && room.dataset.heat === 'hot') {
        const level = mistLevels[Math.floor(now / 420) % mistLevels.length];
        if (level !== mistLevel) {
          haze.style.opacity = String(level);
          mistLevel = level;
        }
      }
    }

    function render(state,stage,drops) {
      let changed=lastLocation!==state.location;
      if(changed){
        background(state.location);
        updateTargets(state.location);
        if(state.location==='mall'){
          signLight=light('neon',56,1,93,46);
          signOn=true;
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
          const footprint={laptop:[26,15],tower:[17,25],rack:[30,28],gpu:[42,24],cluster:[40,31],mainframe:[34,34],exascale:[48,28],fan:[22,11],liquid:[26,29]}[id];
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
            const offsets={laptop:[17,23],tower:[10,20],rack:[9,22],gpu:[14,23],ac:[7,17],fan:[1,19],liquid:[8,22],cluster:[9,24],mainframe:[7,24],exascale:[11,27]};
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
      updateAccents();
      if(changed){
        const labels={laptop:'Old Laptop',tower:'Desktop Tower',rack:'Rack Server',gpu:'GPU Rig',cluster:'AI Training Cluster',mainframe:'Quantum Mainframe',exascale:'Exascale Array',ac:'Window AC',fan:'Box Fan',liquid:'Liquid Loop',sibling:'Little Sibling',sysadmin:'Sysadmin',manager:'Purchasing Manager'};
        const contents=order.filter(id=>groups.get(id).count).map(id=>labels[id]+(id in state.staff?' level ':' ×')+groups.get(id).count);
        svg.setAttribute('aria-label',window.Economy.LOCATIONS[state.location].room+'. '+(contents.length?contents.join(', '):'An empty workbench is ready for your first laptop.'));
      }
    }
    return {render,setDecor};
  }
  window.RoomScene={mount,thumbnail};
})();
