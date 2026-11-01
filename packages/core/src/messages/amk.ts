/**
 * The message of every `AMK` diagnostic: conditions AddmusicK itself reports.
 *
 * Keyed by code, then by variant where one code says several things. Each entry cites the line
 * AddmusicK raises it from, and is a function so nothing builds a message at import. The words are
 * under the same ID in web/src/locale/messages.en.json.
 */
export const AMK = {
	/** Music.cpp:337-380 */
	"0002": () => $localize`:@@amk.0002:amk.0002`,
	/** Music.cpp:337-380 */
	"0003": (version: number, supported: number) =>
		$localize`:@@amk.0003:amk.0003 ${version}:version: ${supported}:supported:`,
	/** Music.cpp:2916 */
	"0010": () => $localize`:@@amk.0010:amk.0010`,
	/** Music.cpp:3662 */
	"0011": () => $localize`:@@amk.0011:amk.0011`,
	/** Music.cpp:3662 */
	"0012": () => $localize`:@@amk.0012:amk.0012`,
	/** Music.cpp:2518 */
	"0021": () => $localize`:@@amk.0021:amk.0021`,
	/** Music.cpp:2518 */
	"0022": () => $localize`:@@amk.0022:amk.0022`,
	/** Music.cpp:139 */
	"0023": () => $localize`:@@amk.0023:amk.0023`,
	/** Music.cpp:561 */
	"0030": () => $localize`:@@amk.0030:amk.0030`,
	/** Music.cpp:543-544 */
	"0031": () => $localize`:@@amk.0031:amk.0031`,
	/** Music.cpp:2497 */
	"0040": () => $localize`:@@amk.0040:amk.0040`,
	/** Music.cpp:2339 */
	"0041": () => $localize`:@@amk.0041:amk.0041`,
	/** Music.cpp:2385 */
	"0042": () => $localize`:@@amk.0042:amk.0042`,
	/** Music.cpp:2387 */
	"0043": () => $localize`:@@amk.0043:amk.0043`,
	/** Music.cpp:2388 */
	"0044": () => $localize`:@@amk.0044:amk.0044`,
	/** Music.cpp:2413-2506 */
	"0045": () => $localize`:@@amk.0045:amk.0045`,
	/** Music.cpp:3348 */
	"0046": () => $localize`:@@amk.0046:amk.0046`,
	/** Music.cpp:3365 */
	"0047": () => $localize`:@@amk.0047:amk.0047`,
	/** Music.cpp:3386 */
	"0048": () => $localize`:@@amk.0048:amk.0048`,
	/** Music.cpp:3415 */
	"0049": () => $localize`:@@amk.0049:amk.0049`,
	/** Music.cpp:2702 */
	"0050": () => $localize`:@@amk.0050:amk.0050`,
	/** Music.cpp:2551 */
	"0051": () => $localize`:@@amk.0051:amk.0051`,
	/** Music.cpp:2776-2789 */
	"0052": () => $localize`:@@amk.0052:amk.0052`,
	/** AddmusicK.cpp:1266 */
	"0053": () => $localize`:@@amk.0053:amk.0053`,
	/** Music.cpp:3445 */
	"0054": () => $localize`:@@amk.0054:amk.0054`,
	/** Music.cpp:2723-2728 */
	"0056": (name: string) => $localize`:@@amk.0056:amk.0056 ${name}:name:`,
	/** Music.cpp:2749 */
	"0057": (character: string) => $localize`:@@amk.0057:amk.0057 ${character}:character:`,
	/** Music.cpp:2723-2728 */
	"0058": (name: string) => $localize`:@@amk.0058:amk.0058 ${name}:name:`,
	/** globals.cpp:238 */
	"0059": (group: string) => $localize`:@@amk.0059:amk.0059 ${group}:group:`,
	/** globals.cpp:238 */
	"0059.available": (group: string, groups: string) =>
		$localize`:@@amk.0059.available:amk.0059.available ${group}:group: ${groups}:groups:`,
	/** Music.cpp:3452 */
	"0060": () => $localize`:@@amk.0060:amk.0060`,
	/** Music.cpp:3452 */
	"0061": () => $localize`:@@amk.0061:amk.0061`,
	/** Music.cpp:3452 */
	"0062": () => $localize`:@@amk.0062:amk.0062`,
	/** Music.cpp:3471 */
	"0063": (field: string) => $localize`:@@amk.0063:amk.0063 ${field}:field:`,
	/** globals.cpp:658 */
	"0064": () => $localize`:@@amk.0064:amk.0064`,
	/** Music.cpp:3471 */
	"0065": (field: string) => $localize`:@@amk.0065:amk.0065 ${field}:field:`,
	/** Music.cpp:3493-3521 */
	"0066": () => $localize`:@@amk.0066:amk.0066`,
	/** Music.cpp:3515 */
	"0067": () => $localize`:@@amk.0067:amk.0067`,
	/** globals.cpp:676 */
	"0068": () => $localize`:@@amk.0068:amk.0068`,
	/** Music.cpp:2551 */
	"0069": () => $localize`:@@amk.0069:amk.0069`,
	/** Music.cpp:590 */
	"0070": () => $localize`:@@amk.0070:amk.0070`,
	/** Music.cpp:595 */
	"0071": () => $localize`:@@amk.0071:amk.0071`,
	/** Music.cpp:636 */
	"0072.duration": () => $localize`:@@amk.0072.duration:amk.0072.duration`,
	/** Music.cpp:614 */
	"0072.parse": () => $localize`:@@amk.0072.parse:amk.0072.parse`,
	/** Music.cpp:629 */
	"0072.value": () => $localize`:@@amk.0072.value:amk.0072.value`,
	/** Music.cpp:671 */
	"0073.duration": () => $localize`:@@amk.0073.duration:amk.0073.duration`,
	/** Music.cpp:649 */
	"0073.parse": () => $localize`:@@amk.0073.parse:amk.0073.parse`,
	/** Music.cpp:664 */
	"0073.value": () => $localize`:@@amk.0073.value:amk.0073.value`,
	/** Music.cpp:681 */
	"0074": () => $localize`:@@amk.0074:amk.0074`,
	/** Music.cpp:704 */
	"0075": () => $localize`:@@amk.0075:amk.0075`,
	/** Music.cpp:714 */
	"0076": () => $localize`:@@amk.0076:amk.0076`,
	/** Music.cpp:705 */
	"0076.range": () => $localize`:@@amk.0076.range:amk.0076.range`,
	/** Music.cpp:751 */
	"0077": () => $localize`:@@amk.0077:amk.0077`,
	/** Music.cpp:751 */
	"0078": () => $localize`:@@amk.0078:amk.0078`,
	/** Music.cpp:808 */
	"0078.duration": () => $localize`:@@amk.0078.duration:amk.0078.duration`,
	/** Music.cpp:751 */
	"0079": () => $localize`:@@amk.0079:amk.0079`,
	/** Music.cpp:731 */
	"0080": () => $localize`:@@amk.0080:amk.0080`,
	/** Music.cpp:821 */
	"0081": () => $localize`:@@amk.0081:amk.0081`,
	/** Music.cpp:851 */
	"0082": () => $localize`:@@amk.0082:amk.0082`,
	/** Music.cpp:822 */
	"0082.instrument": () => $localize`:@@amk.0082.instrument:amk.0082.instrument`,
	/** Music.cpp:860 */
	"0083": () => $localize`:@@amk.0083:amk.0083`,
	/** Music.cpp:861 */
	"0084": () => $localize`:@@amk.0084:amk.0084`,
	/** Music.cpp:1407 */
	"0085": () => $localize`:@@amk.0085:amk.0085`,
	/** Music.cpp:1417 */
	"0086": () => $localize`:@@amk.0086:amk.0086`,
	/** Music.cpp:2641 */
	"0087": () => $localize`:@@amk.0087:amk.0087`,
	/** Music.cpp:2551 */
	"0088": () => $localize`:@@amk.0088:amk.0088`,
	/** Music.cpp:2596-2607 */
	"0089": (name: string) => $localize`:@@amk.0089:amk.0089 ${name}:name:`,
	/** Music.cpp:875 */
	"0090": () => $localize`:@@amk.0090:amk.0090`,
	/** Music.cpp:876 */
	"0091": () => $localize`:@@amk.0091:amk.0091`,
	/** Music.cpp:889 */
	"0092": (instrument: number) => $localize`:@@amk.0092:amk.0092 ${instrument}:instrument:`,
	/** Music.cpp:910 */
	"0093": () => $localize`:@@amk.0093:amk.0093`,
	/** Music.cpp:910 */
	"0094": () => $localize`:@@amk.0094:amk.0094`,
	/** Music.cpp:1348 */
	"0095": () => $localize`:@@amk.0095:amk.0095`,
	/** Music.cpp:1363 */
	"0096.delay": () => $localize`:@@amk.0096.delay:amk.0096.delay`,
	/** Music.cpp:1365 */
	"0096.extent": () => $localize`:@@amk.0096.extent:amk.0096.extent`,
	/** Music.cpp:1364 */
	"0096.rate": () => $localize`:@@amk.0096.rate:amk.0096.rate`,
	/** Music.cpp:1390 */
	"0097": () => $localize`:@@amk.0097:amk.0097`,
	/** Music.cpp:1398 */
	"0098": () => $localize`:@@amk.0098:amk.0098`,
	/** Music.cpp:1425 */
	"0099": () => $localize`:@@amk.0099:amk.0099`,
	/** Music.cpp:431 */
	"0100": (character: string) => $localize`:@@amk.0100:amk.0100 ${character}:character:`,
	/** Music.cpp:511 */
	"0101": () => $localize`:@@amk.0101:amk.0101`,
	/** Music.cpp:2596-2607 */
	"0102": () => $localize`:@@amk.0102:amk.0102`,
	/** Music.cpp:2627 */
	"0103": () => $localize`:@@amk.0103:amk.0103`,
	/** Music.cpp:2596-2607 */
	"0104": () => $localize`:@@amk.0104:amk.0104`,
	/** Music.cpp:2616 */
	"0105": () => $localize`:@@amk.0105:amk.0105`,
	/** Music.cpp:2596-2607 */
	"0106": (character: string) => $localize`:@@amk.0106:amk.0106 ${character}:character:`,
	/** Music.cpp:2736 */
	"0107": (name: string) => $localize`:@@amk.0107:amk.0107 ${name}:name:`,
	/** Music.cpp:2709 */
	"0108": () => $localize`:@@amk.0108:amk.0108`,
	/** Music.cpp:889 */
	"0109": (instrument: number, sample: number, count: number) =>
		$localize`:@@amk.0109:amk.0109 ${instrument}:instrument: ${sample}:sample: ${count}:count:`,
	/** Music.cpp:932 */
	"0110": () => $localize`:@@amk.0110:amk.0110`,
	/** Music.cpp:1129 */
	"0111": () => $localize`:@@amk.0111:amk.0111`,
	/** Music.cpp:1156 */
	"0111.paren": () => $localize`:@@amk.0111.paren:amk.0111.paren`,
	/** Music.cpp:1153 */
	"0112": () => $localize`:@@amk.0112:amk.0112`,
	/** Music.cpp:1155 */
	"0113": () => $localize`:@@amk.0113:amk.0113`,
	/** Music.cpp:1157 */
	"0114": () => $localize`:@@amk.0114:amk.0114`,
	/** Music.cpp:1178 */
	"0115": () => $localize`:@@amk.0115:amk.0115`,
	/** Music.cpp:1183 */
	"0116": () => $localize`:@@amk.0116:amk.0116`,
	/** Music.cpp:1010 */
	"0117": () => $localize`:@@amk.0117:amk.0117`,
	/** Music.cpp:1242-1251 */
	"0120": () => $localize`:@@amk.0120:amk.0120`,
	/** Music.cpp:1216 */
	"0121": () => $localize`:@@amk.0121:amk.0121`,
	/** Music.cpp:1217 */
	"0122": () => $localize`:@@amk.0122:amk.0122`,
	/** Music.cpp:1229 */
	"0123": () => $localize`:@@amk.0123:amk.0123`,
	/** Music.cpp:1246 */
	"0124": () => $localize`:@@amk.0124:amk.0124`,
	/** Music.cpp:1240 */
	"0125": () => $localize`:@@amk.0125:amk.0125`,
	/** Music.cpp:1240 */
	"0126": () => $localize`:@@amk.0126:amk.0126`,
	/** Music.cpp:1277 */
	"0127": () => $localize`:@@amk.0127:amk.0127`,
	/** Music.cpp:1279 */
	"0128": () => $localize`:@@amk.0128:amk.0128`,
	/** Music.cpp:1291 */
	"0129": () => $localize`:@@amk.0129:amk.0129`,
	/** Music.cpp:1827 */
	"0131": () => $localize`:@@amk.0131:amk.0131`,
	/** Music.cpp:932 */
	"0132": (name: string) => $localize`:@@amk.0132:amk.0132 ${name}:name:`,
	/** Music.cpp:932 */
	"0133": () => $localize`:@@amk.0133:amk.0133`,
	/** Music.cpp:932 */
	"0134": () => $localize`:@@amk.0134:amk.0134`,
	/** Music.cpp:932 */
	"0135": () => $localize`:@@amk.0135:amk.0135`,
	/** Music.cpp:988 */
	"0136": () => $localize`:@@amk.0136:amk.0136`,
	/** Music.cpp:1156 */
	"0137": () => $localize`:@@amk.0137:amk.0137`,
	/** Music.cpp:1015-1123 */
	"0138": () => $localize`:@@amk.0138:amk.0138`,
	/** Music.cpp:1015-1123 */
	"0139": () => $localize`:@@amk.0139:amk.0139`,
	/** Music.cpp:2141 */
	"0140": () => $localize`:@@amk.0140:amk.0140`,
	/** Music.cpp:2170 */
	"0141": () => $localize`:@@amk.0141:amk.0141`,
	/** Music.cpp:2176 */
	"0142": () => $localize`:@@amk.0142:amk.0142`,
	/** Music.cpp:1068 */
	"0143": () => $localize`:@@amk.0143:amk.0143`,
	/** Music.cpp:1037 */
	"0144": () => $localize`:@@amk.0144:amk.0144`,
	/** Music.cpp:1037 */
	"0145": () => $localize`:@@amk.0145:amk.0145`,
	/** Music.cpp:1037 */
	"0146": () => $localize`:@@amk.0146:amk.0146`,
	/** Music.cpp:1037 */
	"0147": () => $localize`:@@amk.0147:amk.0147`,
	/** Music.cpp:1100 */
	"0148": () => $localize`:@@amk.0148:amk.0148`,
	/** Music.cpp:1101 */
	"0149": () => $localize`:@@amk.0149:amk.0149`,
	/** Music.cpp:1475 */
	"0150": () => $localize`:@@amk.0150:amk.0150`,
	/** Music.cpp:1699-1713 */
	"0151": (byte: string) => $localize`:@@amk.0151:amk.0151 ${byte}:byte:`,
	/** Music.cpp:1699-1713 */
	"0152": (byte: string) => $localize`:@@amk.0152:amk.0152 ${byte}:byte:`,
	/** Music.cpp:1114 */
	"0153": () => $localize`:@@amk.0153:amk.0153`,
	/** Music.cpp:1699-1713 */
	"0154": () => $localize`:@@amk.0154:amk.0154`,
	/** Music.cpp:440 */
	"0155": () => $localize`:@@amk.0155:amk.0155`,
	/** Music.cpp:1792 */
	"0156": () => $localize`:@@amk.0156:amk.0156`,
	/** Music.cpp:1784 */
	"0157": () => $localize`:@@amk.0157:amk.0157`,
	/** Music.cpp:1952-1957 */
	"0158": (byte: string) => $localize`:@@amk.0158:amk.0158 ${byte}:byte:`,
	/** Music.cpp:1990 */
	"0159": () => $localize`:@@amk.0159:amk.0159`,
	/** Music.cpp:1981 */
	"0160": () => $localize`:@@amk.0160:amk.0160`,
	/** Music.cpp:2020 */
	"0161": () => $localize`:@@amk.0161:amk.0161`,
	/** Music.cpp:2102 */
	"0162": () => $localize`:@@amk.0162:amk.0162`,
	/** Music.cpp:1438 */
	"0163": () => $localize`:@@amk.0163:amk.0163`,
	/** Music.cpp:1294 */
	"0164": () => $localize`:@@amk.0164:amk.0164`,
	/** Music.cpp:2138 */
	"0165": () => $localize`:@@amk.0165:amk.0165`,
	/** Music.cpp:598 */
	"0200.default-length": () => $localize`:@@amk.0200.default-length:amk.0200.default-length`,
	/** Music.cpp:2952 */
	"0200.dot": () => $localize`:@@amk.0200.dot:amk.0200.dot`,
	/** Music.cpp:2949 */
	"0200.dots": (dots: number) => $localize`:@@amk.0200.dots:amk.0200.dots ${dots}:dots:`,
	/** Music.cpp:2930 */
	"0200.length": () => $localize`:@@amk.0200.length:amk.0200.length`,
	/** Music.cpp:2960 */
	"0200.triplet": () => $localize`:@@amk.0200.triplet:amk.0200.triplet`,
	/** Music.cpp:3662 */
	"0201": () => $localize`:@@amk.0201:amk.0201`,
	/** Music.cpp:2354 */
	"0202": () => $localize`:@@amk.0202:amk.0202`,
	/** Music.cpp:2354 */
	"0203": () => $localize`:@@amk.0203:amk.0203`,
	/** Music.cpp:2465 */
	"0204": () => $localize`:@@amk.0204:amk.0204`,
	/** Music.cpp:2297 */
	"0205.transpose": () => $localize`:@@amk.0205.transpose:amk.0205.transpose`,
	/** Music.cpp:3493-3521 */
	"0205.truncated": (field: string, length: number, truncated: string) =>
		$localize`:@@amk.0205.truncated:amk.0205.truncated ${field}:field: ${length}:length: ${truncated}:truncated:`,
	/** Music.cpp:2141 */
	"0206": () => $localize`:@@amk.0206:amk.0206`,
	/** Music.cpp:1688 */
	"0207.am4": () => $localize`:@@amk.0207.am4:amk.0207.am4`,
	/** Music.cpp:1692 */
	"0207.amm": () => $localize`:@@amk.0207.amm:amk.0207.amm`,
	/** Music.cpp:1699-1713 */
	"0208": () => $localize`:@@amk.0208:amk.0208`,
	/** Music.cpp:1699-1713 */
	"0209": () => $localize`:@@amk.0209:amk.0209`,
	/** Music.cpp:1699-1713 */
	"0210": () => $localize`:@@amk.0210:amk.0210`,
	/** Music.cpp:1776 */
	"0211": () => $localize`:@@amk.0211:amk.0211`,
	/** Music.cpp:1952-1957 */
	"0212": (byte: string) => $localize`:@@amk.0212:amk.0212 ${byte}:byte:`,
	/** Music.cpp:3286 */
	"0213": (excess: string, reserved: string) => $localize`:@@amk.0213:amk.0213 ${excess}:excess: ${reserved}:reserved:`,
	/** Music.cpp:2388 */
	"0214": () => $localize`:@@amk.0214:amk.0214`,
	/** Music.cpp:2394 */
	"0215": () => $localize`:@@amk.0215:amk.0215`,
	/** Music.cpp:2125 */
	"0216": () => $localize`:@@amk.0216:amk.0216`,
	/** Music.cpp:3238 */
	"0217": () => $localize`:@@amk.0217:amk.0217`,
	/** Music.cpp:2020 */
	"0218": () => $localize`:@@amk.0218:amk.0218`,
	/** AddmusicK.cpp:1331-1333 */
	"0300": (address: string, length: string, end: string) =>
		$localize`:@@amk.0300:amk.0300 ${address}:address: ${length}:length: ${end}:end:`,
	/** Music.cpp:3209 */
	"0302": () => $localize`:@@amk.0302:amk.0302`,
	/** Music.cpp:3214 */
	"0303": () => $localize`:@@amk.0303:amk.0303`,
	/** globals.cpp:944 */
	"0400.amk-integer": () => $localize`:@@amk.0400.amk-integer:amk.0400.amk-integer`,
	/** globals.cpp:795 */
	"0400.define-argument": () => $localize`:@@amk.0400.define-argument:amk.0400.define-argument`,
	/** globals.cpp:810 */
	"0400.define-integer": () => $localize`:@@amk.0400.define-integer:amk.0400.define-integer`,
	/** globals.cpp:923 */
	"0400.endif-unmatched": () => $localize`:@@amk.0400.endif-unmatched:amk.0400.endif-unmatched`,
	/** globals.cpp:665 */
	"0400.eof": () => $localize`:@@amk.0400.eof:amk.0400.eof`,
	/** globals.cpp:868 */
	"0400.if-first-argument": () => $localize`:@@amk.0400.if-first-argument:amk.0400.if-first-argument`,
	/** globals.cpp:894 */
	"0400.if-integer": () => $localize`:@@amk.0400.if-integer:amk.0400.if-integer`,
	/** globals.cpp:877 */
	"0400.if-operator": () => $localize`:@@amk.0400.if-operator:amk.0400.if-operator`,
	/** globals.cpp:883 */
	"0400.if-second-argument": () => $localize`:@@amk.0400.if-second-argument:amk.0400.if-second-argument`,
	/** globals.cpp:871 */
	"0400.if-undefined": () => $localize`:@@amk.0400.if-undefined:amk.0400.if-undefined`,
	/** globals.cpp:910 */
	"0400.if-unknown-operator": () => $localize`:@@amk.0400.if-unknown-operator:amk.0400.if-unknown-operator`,
	/** globals.cpp:832 */
	"0400.ifdef-argument": () => $localize`:@@amk.0400.ifdef-argument:amk.0400.ifdef-argument`,
	/** globals.cpp:853 */
	"0400.ifndef-argument": () => $localize`:@@amk.0400.ifndef-argument:amk.0400.ifndef-argument`,
	/** globals.cpp:822 */
	"0400.undef-argument": () => $localize`:@@amk.0400.undef-argument:amk.0400.undef-argument`,
	/** globals.cpp:933 */
	"0401": () => $localize`:@@amk.0401:amk.0401`,
	/** globals.cpp:949 */
	"0402": () => $localize`:@@amk.0402:amk.0402`,
	/** globals.cpp:977 */
	"0403": () => $localize`:@@amk.0403:amk.0403`,
};
