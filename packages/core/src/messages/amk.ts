/**
 * The text of every `AMK` diagnostic: conditions AddmusicK itself reports.
 *
 * Keyed by code, then by variant where one code says several things. Each entry cites the line
 * AddmusicK raises it from, and is a function so nothing runs `$localize` at import.
 */
export const AMK = {
	/** Music.cpp:337-380 */
	"0002": () => $localize`:@@amk.0002:Song did not specify a target program with "#amk", "#am4" or "#amm".`,
	/** Music.cpp:337-380 */
	"0003": (version: number, supported: number) =>
		$localize`:@@amk.0003:This song was made for a newer version of AddmusicK (#amk ${version}:version:); only up to ${supported}:supported: is supported.`,
	/** Music.cpp:2916 */
	"0010": () => $localize`:@@amk.0010:Error parsing note length.`,
	/** Music.cpp:3662 */
	"0011": () => $localize`:@@amk.0011:Using the tempo ratio on this value would produce a fractional value.`,
	/** Music.cpp:3662 */
	"0012": () => $localize`:@@amk.0012:Using the tempo ratio on this value would overflow.`,
	/** Music.cpp:2518 */
	"0021": () => $localize`:@@amk.0021:Error parsing replacement directive; could not find '='.`,
	/** Music.cpp:2518 */
	"0022": () => $localize`:@@amk.0022:Error parsing replacement directive; string to find was empty.`,
	/** Music.cpp:139 */
	"0023": () => $localize`:@@amk.0023:Replacement expansion did not terminate (recursive definition?).`,
	/** Music.cpp:561 */
	"0030": () => $localize`:@@amk.0030:Error parsing channel directive.`,
	/** Music.cpp:543-544 */
	"0031": () => $localize`:@@amk.0031:Illegal value for channel directive; must be #0 to #7.`,
	/** Music.cpp:2497 */
	"0040": () => $localize`:@@amk.0040:#halvetempo must be used before any and all channels.`,
	/** Music.cpp:2339 */
	"0041": () => $localize`:@@amk.0041:#option directives must be used before any and all channels.`,
	/** Music.cpp:2385 */
	"0042": () => $localize`:@@amk.0042:Missing integer argument for #option dividetempo.`,
	/** Music.cpp:2387 */
	"0043": () => $localize`:@@amk.0043:Argument for #option dividetempo cannot be 0.`,
	/** Music.cpp:2388 */
	"0044": () => $localize`:@@amk.0044:#option directive missing or unrecognised first argument.`,
	/** Music.cpp:2413-2506 */
	"0045": () => $localize`:@@amk.0045:#option is not available in #amk 1.`,
	/** Music.cpp:3348 */
	"0046": () => $localize`:@@amk.0046:A #define was found after the preprocessing stage.`,
	/** Music.cpp:3365 */
	"0047": () => $localize`:@@amk.0047:An #undef was found after the preprocessing stage.`,
	/** Music.cpp:3386 */
	"0048": () => $localize`:@@amk.0048:An #ifdef was found after the preprocessing stage.`,
	/** Music.cpp:3415 */
	"0049": () => $localize`:@@amk.0049:An #ifndef was found after the preprocessing stage.`,
	/** Music.cpp:2702 */
	"0050": () => $localize`:@@amk.0050:Unexpected character in #samples; expected "{".`,
	/** Music.cpp:2551 */
	"0051": () => $localize`:@@amk.0051:Could not find the opening brace in #instruments; expected "{".`,
	/** Music.cpp:2776-2789 */
	"0052": () => $localize`:@@amk.0052:Unexpected symbol in #path; expected a quoted string.`,
	/** AddmusicK.cpp:1266 */
	"0053": () => $localize`:@@amk.0053:Error parsing #pad; the size must be a $ hex value.`,
	/** Music.cpp:3445 */
	"0054": () => $localize`:@@amk.0054:An #endif was found after the preprocessing stage.`,
	/** Music.cpp:2723-2728 */
	"0056": (name: string) =>
		$localize`:@@amk.0056:"${name}:name:" is not a valid sample; only ".brr" and ".bnk" are allowed.`,
	/** Music.cpp:2749 */
	"0057": (character: string) => $localize`:@@amk.0057:Unexpected character "${character}:character:" in #samples.`,
	/** Music.cpp:2723-2728 */
	"0058": (name: string) => $localize`:@@amk.0058:Could not find the sample "${name}:name:".`,
	/** globals.cpp:238 */
	"0059": (group: string) => $localize`:@@amk.0059:The sample group "#${group}:group:" could not be found.`,
	/** globals.cpp:238 */
	"0059.available": (group: string, groups: string) =>
		$localize`:@@amk.0059.available:The sample group "#${group}:group:" could not be found. Available groups: ${groups}:groups:.`,
	/** Music.cpp:3452 */
	"0060": () => $localize`:@@amk.0060:Error parsing #spc; expected "{".`,
	/** Music.cpp:3452 */
	"0061": () => $localize`:@@amk.0061:Unterminated #spc block.`,
	/** Music.cpp:3452 */
	"0062": () => $localize`:@@amk.0062:Error parsing #spc; expected a field name or "}".`,
	/** Music.cpp:3471 */
	"0063": (field: string) =>
		$localize`:@@amk.0063:Error parsing #spc; field "${field}:field:" is missing its quoted value.`,
	/** globals.cpp:658 */
	"0064": () => $localize`:@@amk.0064:Unterminated string.`,
	/** Music.cpp:3471 */
	"0065": (field: string) => $localize`:@@amk.0065:Unknown #spc field "#${field}:field:".`,
	/** Music.cpp:3493-3521 */
	"0066": () => $localize`:@@amk.0066:Error parsing #spc #length; format must be "m:ss" or "auto".`,
	/** Music.cpp:3515 */
	"0067": () => $localize`:@@amk.0067:Songs longer than 16:39 are not allowed by the SPC format.`,
	/** globals.cpp:676 */
	"0068": () => $localize`:@@amk.0068:The only escape sequence allowed inside a string is \\".`,
	/** Music.cpp:2551 */
	"0069": () => $localize`:@@amk.0069:Unexpected end of file while parsing #instruments.`,
	/** Music.cpp:590 */
	"0070": () => $localize`:@@amk.0070:Error parsing "l" directive.`,
	/** Music.cpp:595 */
	"0071": () => $localize`:@@amk.0071:Illegal value for "l" directive.`,
	/** Music.cpp:636 */
	"0072.duration": () => $localize`:@@amk.0072.duration:Illegal duration for global volume ("w") command.`,
	/** Music.cpp:614 */
	"0072.parse": () => $localize`:@@amk.0072.parse:Error parsing global volume ("w") command.`,
	/** Music.cpp:629 */
	"0072.value": () => $localize`:@@amk.0072.value:Illegal value for global volume ("w") command.`,
	/** Music.cpp:671 */
	"0073.duration": () => $localize`:@@amk.0073.duration:Illegal duration for volume ("v") command.`,
	/** Music.cpp:649 */
	"0073.parse": () => $localize`:@@amk.0073.parse:Error parsing volume ("v") command.`,
	/** Music.cpp:664 */
	"0073.value": () => $localize`:@@amk.0073.value:Illegal value for volume ("v") command.`,
	/** Music.cpp:681 */
	"0074": () => $localize`:@@amk.0074:Error parsing quantization ("q") command; expected a hex value from 01 to 7F.`,
	/** Music.cpp:704 */
	"0075": () => $localize`:@@amk.0075:Error parsing pan ("y") command.`,
	/** Music.cpp:714 */
	"0076": () => $localize`:@@amk.0076:Illegal value for pan ("y") command.`,
	/** Music.cpp:705 */
	"0076.range": () => $localize`:@@amk.0076.range:Illegal value for pan ("y") command; must be 0 to 20.`,
	/** Music.cpp:751 */
	"0077": () => $localize`:@@amk.0077:Error parsing tempo ("t") command.`,
	/** Music.cpp:751 */
	"0078": () => $localize`:@@amk.0078:Illegal value for tempo ("t") command.`,
	/** Music.cpp:808 */
	"0078.duration": () => $localize`:@@amk.0078.duration:Illegal duration for tempo ("t") command.`,
	/** Music.cpp:751 */
	"0079": () => $localize`:@@amk.0079:Tempo has been zeroed out by #halvetempo / #option dividetempo.`,
	/** Music.cpp:731 */
	"0080": () => $localize`:@@amk.0080:Intro directive found within a loop.`,
	/** Music.cpp:821 */
	"0081": () => $localize`:@@amk.0081:Error parsing tuning directive.`,
	/** Music.cpp:851 */
	"0082": () => $localize`:@@amk.0082:Illegal value for tuning directive.`,
	/** Music.cpp:822 */
	"0082.instrument": () => $localize`:@@amk.0082.instrument:Illegal instrument value for tuning directive.`,
	/** Music.cpp:860 */
	"0083": () => $localize`:@@amk.0083:Error parsing octave ("o") directive.`,
	/** Music.cpp:861 */
	"0084": () => $localize`:@@amk.0084:Illegal value for octave ("o") directive; must be 0 to 6.`,
	/** Music.cpp:1407 */
	"0085": () => $localize`:@@amk.0085:The octave has been raised too high.`,
	/** Music.cpp:1417 */
	"0086": () => $localize`:@@amk.0086:The octave has been dropped too low.`,
	/** Music.cpp:2641 */
	"0087": () =>
		$localize`:@@amk.0087:Error parsing #instruments; every instrument needs exactly six bytes — a sample followed by five $xx values.`,
	/** Music.cpp:2551 */
	"0088": () => $localize`:@@amk.0088:Error parsing #instruments; expected a one-byte hex value.`,
	/** Music.cpp:2596-2607 */
	"0089": (name: string) =>
		$localize`:@@amk.0089:The sample "${name}:name:" was not included in this song; add it to #samples first.`,
	/** Music.cpp:875 */
	"0090": () => $localize`:@@amk.0090:Error parsing instrument ("@") command.`,
	/** Music.cpp:876 */
	"0091": () => $localize`:@@amk.0091:Illegal value for instrument ("@") command.`,
	/** Music.cpp:889 */
	"0092": (instrument: number) =>
		$localize`:@@amk.0092:Custom instrument @${instrument}:instrument: has not been defined yet. Define it in an #instruments block; the first entry there is @30.`,
	/** Music.cpp:910 */
	"0093": () => $localize`:@@amk.0093:Error parsing transpose ("h") directive.`,
	/** Music.cpp:910 */
	"0094": () => $localize`:@@amk.0094:Invalid value for the "n" command; must be a hex value from 0 to 1F.`,
	/** Music.cpp:1348 */
	"0095": () => $localize`:@@amk.0095:Error parsing vibrato command.`,
	/** Music.cpp:1363 */
	"0096.delay": () => $localize`:@@amk.0096.delay:Illegal value for vibrato delay.`,
	/** Music.cpp:1365 */
	"0096.extent": () => $localize`:@@amk.0096.extent:Illegal value for vibrato extent.`,
	/** Music.cpp:1364 */
	"0096.rate": () => $localize`:@@amk.0096.rate:Illegal value for vibrato rate.`,
	/** Music.cpp:1390 */
	"0097": () => $localize`:@@amk.0097:Triplet-open directive found within a triplet block.`,
	/** Music.cpp:1398 */
	"0098": () => $localize`:@@amk.0098:Triplet-close directive found outside a triplet block.`,
	/** Music.cpp:1425 */
	"0099": () => $localize`:@@amk.0099:Pitch slide directive specified multiple times in a row.`,
	/** Music.cpp:431 */
	"0100": (character: string) => $localize`:@@amk.0100:Unexpected character "${character}:character:".`,
	/** Music.cpp:511 */
	"0101": () => $localize`:@@amk.0101:Illegal use of comments. Sorry about that.`,
	/** Music.cpp:2596-2607 */
	"0102": () => $localize`:@@amk.0102:Error parsing the instrument-copy portion of #instruments.`,
	/** Music.cpp:2627 */
	"0103": () => $localize`:@@amk.0103:Cannot use a custom instrument's sample as a base for another custom instrument.`,
	/** Music.cpp:2596-2607 */
	"0104": () => $localize`:@@amk.0104:Error parsing the noise portion of #instruments.`,
	/** Music.cpp:2616 */
	"0105": () => $localize`:@@amk.0105:Invalid noise pitch; it must be a hex value from $00 to $1F.`,
	/** Music.cpp:2596-2607 */
	"0106": (character: string) =>
		$localize`:@@amk.0106:Unexpected character "${character}:character:" in #instruments; expected a quoted sample name, @n, or nXX.`,
	/** Music.cpp:2736 */
	"0107": (name: string) =>
		$localize`:@@amk.0107:The sample "${name}:name:" is missing its extension; is it a .brr or a .bnk?`,
	/** Music.cpp:2709 */
	"0108": () => $localize`:@@amk.0108:Unexpected end of file while parsing #samples.`,
	/** Music.cpp:889 */
	"0109": (instrument: number, sample: number, count: number) =>
		$localize`:@@amk.0109:@${instrument}:instrument: plays sample ${sample}:sample:, but this song's #samples list only defines ${count}:count:. Include a group that covers the stock instruments, such as #default.`,
	/** Music.cpp:932 */
	"0110": () => $localize`:@@amk.0110:A sample load must name a stock instrument between @0 and @29, as in (@1, $02).`,
	/** Music.cpp:1129 */
	"0111": () => $localize`:@@amk.0111:Error parsing remote code definition.`,
	/** Music.cpp:1156 */
	"0111.paren": () => $localize`:@@amk.0111.paren:Error parsing remote code definition; expected ")".`,
	/** Music.cpp:1153 */
	"0112": () => $localize`:@@amk.0112:Nested loops are not allowed.`,
	/** Music.cpp:1155 */
	"0113": () => $localize`:@@amk.0113:Error parsing label loop.`,
	/** Music.cpp:1157 */
	"0114": () => $localize`:@@amk.0114:Illegal value for loop label.`,
	/** Music.cpp:1178 */
	"0115": () => $localize`:@@amk.0115:Label not yet defined.`,
	/** Music.cpp:1183 */
	"0116": () => $localize`:@@amk.0116:Invalid loop count.`,
	/** Music.cpp:1010 */
	"0117": () => $localize`:@@amk.0117:Unrecognized character '!'.`,
	/** Music.cpp:1242-1251 */
	"0120": () => $localize`:@@amk.0120:Ambiguous use of "[[[" — separate the "[[" and "[" to clarify your intent.`,
	/** Music.cpp:1216 */
	"0121": () => $localize`:@@amk.0121:You cannot nest a subloop within another subloop.`,
	/** Music.cpp:1217 */
	"0122": () => $localize`:@@amk.0122:A label loop cannot define a subloop. Use a standard or remote loop instead.`,
	/** Music.cpp:1229 */
	"0123": () => $localize`:@@amk.0123:You cannot nest standard [ ] loops.`,
	/** Music.cpp:1246 */
	"0124": () => $localize`:@@amk.0124:Label redefinition.`,
	/** Music.cpp:1240 */
	"0125": () => $localize`:@@amk.0125:Ambiguous use of "]]]" — separate the "]]" and "]" to clarify your intent.`,
	/** Music.cpp:1240 */
	"0126": () => $localize`:@@amk.0126:A subloop cannot repeat only once.`,
	/** Music.cpp:1277 */
	"0127": () => $localize`:@@amk.0127:A subloop end was found outside of a subloop.`,
	/** Music.cpp:1279 */
	"0128": () => $localize`:@@amk.0128:Error parsing subloop command; the loop count was missing.`,
	/** Music.cpp:1291 */
	"0129": () => $localize`:@@amk.0129:Loop end found outside of a loop.`,
	/** Music.cpp:1827 */
	"0131": () =>
		$localize`:@@amk.0131:This song uses custom samples, but has not yet defined its samples with the #samples command.`,
	/** Music.cpp:932 */
	"0132": (name: string) =>
		$localize`:@@amk.0132:The sample "${name}:name:" was not included in this song; add it to #samples first.`,
	/** Music.cpp:932 */
	"0133": () =>
		$localize`:@@amk.0133:Error parsing the sample load command; expected a comma, as in ("kick.brr", $02).`,
	/** Music.cpp:932 */
	"0134": () =>
		$localize`:@@amk.0134:Error parsing the sample load command; the tuning multiplier must be a $xx value.`,
	/** Music.cpp:932 */
	"0135": () => $localize`:@@amk.0135:Error parsing the sample load command's tuning value.`,
	/** Music.cpp:988 */
	"0136": () => $localize`:@@amk.0136:Error parsing the sample load command; expected ")".`,
	/** Music.cpp:1156 */
	"0137": () => $localize`:@@amk.0137:Error parsing remote code definition; the definition body was missing.`,
	/** Music.cpp:1015-1123 */
	"0138": () => $localize`:@@amk.0138:Error parsing remote code reset; expected a number.`,
	/** Music.cpp:1015-1123 */
	"0139": () => $localize`:@@amk.0139:Error parsing remote code reset; expected ")".`,
	/** Music.cpp:2141 */
	"0140": () => $localize`:@@amk.0140:Note data must be inside a channel.`,
	/** Music.cpp:2170 */
	"0141": () => $localize`:@@amk.0141:Note's pitch was too low.`,
	/** Music.cpp:2176 */
	"0142": () => $localize`:@@amk.0142:Note's pitch was too high.`,
	/** Music.cpp:1068 */
	"0143": () => $localize`:@@amk.0143:Error parsing remote code setup.`,
	/** Music.cpp:1037 */
	"0144": () => $localize`:@@amk.0144:Error parsing remote code setup; expected a comma.`,
	/** Music.cpp:1037 */
	"0145": () =>
		$localize`:@@amk.0145:Error parsing remote code setup; the event type was missing. Remote code cannot be defined inside a channel.`,
	/** Music.cpp:1037 */
	"0146": () => $localize`:@@amk.0146:Error parsing remote code setup; the third argument is missing.`,
	/** Music.cpp:1037 */
	"0147": () =>
		$localize`:@@amk.0147:Error parsing remote code setup; could not read the third argument as a hex value.`,
	/** Music.cpp:1100 */
	"0148": () => $localize`:@@amk.0148:The note length specified was too large.`,
	/** Music.cpp:1101 */
	"0149": () => $localize`:@@amk.0149:Error parsing remote code setup; expected ")".`,
	/** Music.cpp:1475 */
	"0150": () => $localize`:@@amk.0150:Error parsing hex command.`,
	/** Music.cpp:1699-1713 */
	"0151": (byte: string) => $localize`:@@amk.0151:$${byte}:byte: is not a command byte (commands are $DA-$FE).`,
	/** Music.cpp:1699-1713 */
	"0152": (byte: string) => $localize`:@@amk.0152:$${byte}:byte: is not a valid command.`,
	/** Music.cpp:1114 */
	"0153": () => $localize`:@@amk.0153:Remote code cannot be defined within a channel.`,
	/** Music.cpp:1699-1713 */
	"0154": () => $localize`:@@amk.0154:$FB is missing its length argument.`,
	/** Music.cpp:440 */
	"0155": () => $localize`:@@amk.0155:Unknown hex command.`,
	/** Music.cpp:1792 */
	"0156": () => $localize`:@@amk.0156:This historical AddmusicM hex command is not implemented in AddmusicK.`,
	/** Music.cpp:1784 */
	"0157": () => $localize`:@@amk.0157:$FA $05 was replaced with remote code in #amk 2 and above.`,
	/** Music.cpp:1952-1957 */
	"0158": (byte: string) =>
		$localize`:@@amk.0158:$${byte}:byte: is not a valid FIR filter for $F1. Must be $00 or $01.`,
	/** Music.cpp:1990 */
	"0159": () => $localize`:@@amk.0159:Cannot nest $E6 loops within other $E6 loops.`,
	/** Music.cpp:1981 */
	"0160": () => $localize`:@@amk.0160:An $E6 loop starting point has not yet been declared.`,
	/** Music.cpp:2020 */
	"0161": () =>
		$localize`:@@amk.0161:You cannot use a note as the last parameter of $DD if qXX was used just before it.`,
	/** Music.cpp:2102 */
	"0162": () => $localize`:@@amk.0162:Illegal value for hex command.`,
	/** Music.cpp:1438 */
	"0163": () => $localize`:@@amk.0163:Unknown HFD hex command.`,
	/** Music.cpp:1294 */
	"0164": () => $localize`:@@amk.0164:Remote code definitions cannot repeat.`,
	/** Music.cpp:2138 */
	"0165": () => $localize`:@@amk.0165:Remote code definitions cannot contain note data.`,
	/** Music.cpp:598 */
	"0200.default-length": () =>
		$localize`:@@amk.0200.default-length:A default note length was used that is not divisible by 192 ticks.`,
	/** Music.cpp:2952 */
	"0200.dot": () => $localize`:@@amk.0200.dot:Adding a dot to this note produces a fractional tick value.`,
	/** Music.cpp:2949 */
	"0200.dots": (dots: number) =>
		$localize`:@@amk.0200.dots:Adding ${dots}:dots: dots to this note produces a fractional tick value.`,
	/** Music.cpp:2930 */
	"0200.length": () =>
		$localize`:@@amk.0200.length:A note length was used that is not divisible by 192 ticks, so it produces a fractional tick value.`,
	/** Music.cpp:2960 */
	"0200.triplet": () => $localize`:@@amk.0200.triplet:Putting this note in a triplet produces a fractional tick value.`,
	/** Music.cpp:3662 */
	"0201": () => $localize`:@@amk.0201:The tempo ratio produced a fractional value.`,
	/** Music.cpp:2354 */
	"0202": () => $localize`:@@amk.0202:Songs use the N-SPC velocity table by default; this command wastes three bytes.`,
	/** Music.cpp:2354 */
	"0203": () => $localize`:@@amk.0203:This song already uses the SMW velocity table; this command wastes three bytes.`,
	/** Music.cpp:2465 */
	"0204": () => $localize`:@@amk.0204:#louder is redundant in #amk 2 and above.`,
	/** Music.cpp:2297 */
	"0205.transpose": () =>
		$localize`:@@amk.0205.transpose:The "h" command is not native to Addmusic 4.05. Did you mean #amm?`,
	/** Music.cpp:3493-3521 */
	"0205.truncated": (field: string, length: number, truncated: string) =>
		$localize`:@@amk.0205.truncated:The "${field}:field:" field is ${length}:length: characters; ID666 allows 32, so it was truncated to "${truncated}:truncated:".`,
	/** Music.cpp:2141 */
	"0206": () =>
		$localize`:@@amk.0206:This older AddmusicK song outputs an invalid note byte (its pitch is too low); it may be inaudible.`,
	/** Music.cpp:1688 */
	"0207.am4": () =>
		$localize`:@@amk.0207.am4:A hex command was used that is not native to Addmusic 4.05. Did you mean #amm?`,
	/** Music.cpp:1692 */
	"0207.amm": () =>
		$localize`:@@amk.0207.amm:A hex command was used that is not native to AddmusicM. Did you mean #amk 1?`,
	/** Music.cpp:1699-1713 */
	"0208": () => $localize`:@@amk.0208:A hex command was found that will act as a note rather than an effect.`,
	/** Music.cpp:1699-1713 */
	"0209": () => $localize`:@@amk.0209:A hex command was found that will act as a duration or quantization byte.`,
	/** Music.cpp:1699-1713 */
	"0210": () =>
		$localize`:@@amk.0210:A hex command was found that will act as a phrase end marker; the song may terminate early.`,
	/** Music.cpp:1776 */
	"0211": () =>
		$localize`:@@amk.0211:$FC errors on AddmusicK 1.0.8 and lower, which replaced it with remote code in #amk 2. For remote gain use $FC $xx $01 $yy $zz.`,
	/** Music.cpp:1952-1957 */
	"0212": (byte: string) =>
		$localize`:@@amk.0212:$${byte}:byte: is a non-standard FIR table ID and reads out of bounds. Only $00 and $01 are consistent; use $F5 for custom coefficients.`,
	/** Music.cpp:3286 */
	"0213": (excess: string, reserved: string) =>
		$localize`:@@amk.0213:This song is 0x${excess}:excess: bytes larger than the 0x${reserved}:reserved: it asked #pad to reserve.`,
	/** Music.cpp:2388 */
	"0214": () => $localize`:@@amk.0214:#option dividetempo 1 has no effect.`,
	/** Music.cpp:2394 */
	"0215": () => $localize`:@@amk.0215:The tempo divisor has grown too large — #halvetempo was used too many times.`,
	/** Music.cpp:2125 */
	"0216": () =>
		$localize`:@@amk.0216:Upper-case note letters will not translate correctly on AddmusicK 1.0.8 or lower.`,
	/** Music.cpp:3238 */
	"0217": () => $localize`:@@amk.0217:A tempo change was found beyond the end of the song.`,
	/** Music.cpp:2020 */
	"0218": () => $localize`:@@amk.0218:Using o after $DD freezes hex validation in AddmusicK 1.0.8 and lower.`,
	/** AddmusicK.cpp:1331-1333 */
	"0300": (address: string, length: string, end: string) =>
		$localize`:@@amk.0300:Song data runs past the end of ARAM (0x${address}:address: + 0x${length}:length: = 0x${end}:end:).`,
	/** Music.cpp:3209 */
	"0302": () => $localize`:@@amk.0302:This song contained no musical data.`,
	/** Music.cpp:3214 */
	"0303": () => $localize`:@@amk.0303:This song doesn't seem to have any data.`,
	/** globals.cpp:944 */
	"0400.amk-integer": () => $localize`:@@amk.0400.amk-integer:Could not parse integer for #amk.`,
	/** globals.cpp:795 */
	"0400.define-argument": () => $localize`:@@amk.0400.define-argument:#define was missing its argument.`,
	/** globals.cpp:810 */
	"0400.define-integer": () => $localize`:@@amk.0400.define-integer:Could not parse integer for #define.`,
	/** globals.cpp:923 */
	"0400.endif-unmatched": () =>
		$localize`:@@amk.0400.endif-unmatched:There was an #endif without a matching #ifdef, #ifndef, or #if.`,
	/** globals.cpp:665 */
	"0400.eof": () => $localize`:@@amk.0400.eof:Unexpected end of file found.`,
	/** globals.cpp:868 */
	"0400.if-first-argument": () => $localize`:@@amk.0400.if-first-argument:#if was missing its first argument.`,
	/** globals.cpp:894 */
	"0400.if-integer": () => $localize`:@@amk.0400.if-integer:Could not parse integer for #if.`,
	/** globals.cpp:877 */
	"0400.if-operator": () => $localize`:@@amk.0400.if-operator:#if was missing its comparison operator.`,
	/** globals.cpp:883 */
	"0400.if-second-argument": () => $localize`:@@amk.0400.if-second-argument:#if was missing its second argument.`,
	/** globals.cpp:871 */
	"0400.if-undefined": () => $localize`:@@amk.0400.if-undefined:First argument for #if was never defined.`,
	/** globals.cpp:910 */
	"0400.if-unknown-operator": () => $localize`:@@amk.0400.if-unknown-operator:Unknown operator for #if.`,
	/** globals.cpp:832 */
	"0400.ifdef-argument": () => $localize`:@@amk.0400.ifdef-argument:#ifdef was missing its argument.`,
	/** globals.cpp:853 */
	"0400.ifndef-argument": () => $localize`:@@amk.0400.ifndef-argument:#ifndef was missing its argument.`,
	/** globals.cpp:822 */
	"0400.undef-argument": () => $localize`:@@amk.0400.undef-argument:#undef was missing its argument.`,
	/** globals.cpp:933 */
	"0401": () => $localize`:@@amk.0401:#amk must have an integer argument specifying the version.`,
	/** globals.cpp:949 */
	"0402": () => $localize`:@@amk.0402:Codec's AddmusicK Beta (#amk 3) has not been implemented.`,
	/** globals.cpp:977 */
	"0403": () => $localize`:@@amk.0403:There was an #ifdef, #ifndef, or #if without a matching #endif.`,
};
