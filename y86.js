//Registers and memory
var PC 		= 0,
	REG		= [0, 0, 0, 0, 0, 0, 0, 0],
	STAT	= 'AOK',
	MEMORY 	= [],
	SF = 0, ZF = 0, OF = 0,
	ERR = 'AOK';

// Include files if in nodejs, otherwise include them manually
if (typeof require !== 'undefined') {
	var fs = require('fs');
	eval(fs.readFileSync('general.js') + '');
	eval(fs.readFileSync('instr.js') + '');
	eval(fs.readFileSync('assem.js') + '');
	eval(fs.readFileSync('syntax.js') + '');
}

// Print
function print (x) {
	console.log(x);
}

// Reset
function RESET() {
	PC 	= 0;
	REG	= [0, 0, 0, 0, 0, 0, 0, 0];
	STAT = 'AOK';
	SF = 0; ZF = 0; OF = 0;
	ERR = 'AOK';
}

// Load
function LD (addr) {
	var result;
	if (addr > MEMORY.length || addr < 0) {
		STAT = 'ADR';
		print("Invalid address. PC = " + addr);
		return 0;
	}
	result  = MEMORY[addr];
	result |= MEMORY[addr + 1] << 8;
	result |= MEMORY[addr + 2] << 16;
	result |= MEMORY[addr + 3] << 24;
	return result;
}

// Store
function ST(addr, data, bytes){
	var result, i;
	if (addr < 0) {
		STAT = 'ADR';
	}
	if (typeof bytes === 'undefined') {
		bytes = Math.ceil(Math.log(data + 1) / Math.log(16) / 2);
		print('No Bytes, using ' + bytes)
	}
	for (i = 0; i < bytes; i++){
		MEMORY[addr + i] = data & 0xFF;
		data = data >> 8;
	}
	return addr;
}

// Decode instruction
function DECODE (bytearr) {
	var args = {
			icode: 	bytearr[0] >> 4,
			fn: 	bytearr[0] & 0x0F
		},
		len = bytearr.length;

	if (len > 1) {
		args['rA'] = (bytearr[1] >> 4) & 0x0F;
		args['rB'] = bytearr[1] & 0x0F;
	}
	if (len === 5) {
		var temp = bytearr[1];
		temp |= bytearr[2] << 8;
		temp |= bytearr[3] << 16;
		temp |= bytearr[4] << 24;
		args['Dest'] = temp;
	} else if (len === 6) {
		var temp = bytearr[2];
		temp |= bytearr[3] << 8;
		temp |= bytearr[4] << 16;
		temp |= bytearr[5] << 24;
		args['D'] = temp;
		args['V'] = temp;
	}
	return args;
}

function evalArgs(list, args, symbols){
	var item, result = {};
	for (i in list) {
		item = list[i];
		if (item === 'rA') {
			result['rA'] = num2reg.indexOf(args[i]).toString(16);
		}
		else if (item === 'rB') {
			result['rB'] = num2reg.indexOf(args[i]).toString(16);
		}
		else if (item === 'V' || item === 'D') {
			if (symbols.hasOwnProperty(args[i])) {
				result['V'] = toBigEndian(padHex(symbols[args[i]], 8));
				result['D'] = result['V'];
			} else {
				args[i] = args[i].replace(/^\$/, '');

				// If negative number...
				if (args[i][0] === '-') {
					args[i] = 0 - eval(args[i].substr(1));
					args[i] = (args[i] >> 24 & 0xFF).toString(16) + (args[i] & 0x00FFFFFF).toString(16);
					result['V'] = toBigEndian(padHex(args[i], 8));
				} else {
					result['V'] = toBigEndian(padHex(eval(args[i]), 8));
				}
				result['D'] = result['V'];
			}
		} else if (item === 'Dest') {
			result['Dest'] = toBigEndian(padHex(symbols[args[i]].toString(16), 8));
		} else if (item === 'D(rB)') {
			result['D'] = toBigEndian(padHex(eval(args[i].replace(/\(.*/, '')), 8));
			result['rB'] = num2reg.indexOf(args[i].replace(/^.*\((.*)\)/, '$1'));
		}
	}
	return result;
}

function ENCODE(instr, symbols) {
	var result = '',
		args = [],
		vars = {},
		icode;

	instr = instr.replace(/\s*,\s*/i, ',');
	args = instr.split(' ');
	instr = args.splice(0, 1)[0];
	args = args[0] ? args[0].split(',') : new Array();

	vars = evalArgs(SYNTAX[instr], args, symbols);
	icode = inst2num[instr];
	if (inst2fn.hasOwnProperty(instr)) {
		vars['fn'] = inst2fn[instr];
	}
	
	if (icode in ASSEM) {
		result = ASSEM[icode].call(vars);
	} else {
		//print('Invalid instruction ' + instr);
		ERR = 'INS';
		return '';
	}
	return result;
}

function ASSEMBLE (raw) {
	var lines = raw.split('\n'), line,
		symbols = {},
		result = new Array(lines.length),
		inst, icode,
		sym, next = 0,
		counter = 0;
		raw = raw.split('\n');
	RESET();
	// Clean up raw e.g. remove comments, fix spacing
	for (i in lines) {
		line = lines[i];
		line = line.replace(/#.*/gi, '');
		line = line.replace(/^\s+/gi, '');
		line = line.replace(/\s+$/gi, '');
		line = line.replace(/\s+/gi, ' ');
		lines[i] = line;
	}
	// Create symbol table and do directives
	for (i in lines) {
		line = lines[i];
		if (line === '') {
			result[i] = ' ';
			continue;
		}
		// Look for symbol and add to symbols
		sym = line.match(/(^.*?):/);
		if (sym) {
			symbols[sym[1]] = counter;
			line = line.replace(/^.*?:\s*/i, '');
			//print('SYMBOL ' + sym[1] + ' at ' + counter);
		}
		// Look for directive
		dir = line.match(/(^\..*?) (.*)/i);
		if (dir) {
			if (dir[1] === '.pos') {
				counter = eval(dir[2]);
			} else if (dir[1] === '.align') {
				counter = Math.ceil(counter / 4) * 4;
			}
		}
		// Add to result str
		result[i] = ' 0x' + padHex(counter, 3) + ': ';		
		if (dir) {
			if (dir[1] === '.long') {
				result[i] += toBigEndian(padHex(eval(dir[2]), 8)) + ' ';
				counter += 4;
			}
			line = line.replace(/(^\..*?) (.*)/i, '');
		}
		// Move counter
		inst = line.match(/(^[a-z]+)/i);
		lines[i] = line;
		if (inst) {
			icode = inst2num[inst[1]];
			counter += INSTRUCTION_LEN[icode];
		}
		step = 0;
	}
	// Assemble each instructions
	counter = 0;
	for (i in lines) {
		line = lines[i];
		inst = line.match(/^([a-z]+)(.*)/i);
		if (inst) {
			result[i] += ENCODE(line, symbols) + ' ';
		}
		if (ERR !== 'AOK') {
			//print('Invalid instruction at ' + counter);
			return 'Invalid instruction "' + line + '" on line ' + (counter + 1);
		}
		result[counter] += '|' + (raw[counter] !== '' ? ' ' + raw[counter] : '');
		counter++;
	}
	result = result.join('\n');
	return result;
}

//Execute a byte array
function EXECUTE (bytearr) {
	var numbytes = bytearr.length,
		icode,
		ilen,
		instr;
		MEMORY 	= bytearr;
		STAT	= 'AOK';
	RESET();
	while (PC < numbytes && STAT === 'AOK') {
		icode = MEMORY[PC] >> 4;
		ilen = INSTRUCTION_LEN[icode];
		instr = MEMORY.slice(PC, PC + ilen);
		args = DECODE(instr);
		//print(PC + ': ');
		//print(args);
		PC += ilen;
		INSTR[icode].call(args);
		//printRegisters(REG);
	}
	return STAT;
}

function hex2arr (str) {
	var result = [], i;
	for (i = 0; i < str.length; i += 2) {
		result.push(parseInt(str[i] + str[i + 1], 16));
	}
	return result;
}

// Object file string to byte array
function toByteArray(str) {
	var lines = str.split('\n'),
		line, addr, size, bytearr;

	// Get size of program, pad with 32 bytes at end
	for (i in lines) {
		line = lines[i];
		addr = line.match(/^\s*0x([\da-f]+)/i);
		if (addr) {
			size = parseInt(addr[1], 16) + 32;
		}
	}
	// Init array with 0's
	bytearr = new Array(size);
	for (var i = 0; i < size; i++) {
		bytearr[i] = 0;
	}
	// Set instructions at correct locations
	for (i in lines) {
		line = lines[i];
		match = line.match(/\s*(0x([0-9a-f]+):\s*)?([0-9a-f]*)\s*\|.*/i);
		if (!match) {
			throw 'Invalid instruction format on line ' + i + ': "' + lines[i] + '"';
		}
		instr = hex2arr(match[3]);
		icode = parseInt(instr[0], 16);
		if (instr !== '') {
			addr = parseInt(match[2], 16);
			for (var i = 0; i < instr.length; i++) {
				bytearr[addr + i] = instr[i];
			}
		}
	}
	return bytearr;
}

//check if on node.js and execute the first arg as a file
if (typeof require !== 'undefined') {
	if (process.argv.length === 4) {
		var option = process.argv[2],
			filename = process.argv[3],
			source = fs.readFileSync(filename, 'utf8');

		if (option === '-a') {
			// assemble file 
			print(ASSEMBLE(source));
		}
		else if (option === '-e') {
			// execute file
			var bytearr = toByteArray(source);
			print('Executing ' + filename + '...');
			EXECUTE(bytearr);
			printRegisters(REG);
			print('STAT = ' + STAT);
		}
		else {
			print('Invalid option. -a for assemble or -e for execute');
		}
	} else {
		print('Invalid format. Must be formatted like \'node y86.js option filename\'.');
	}
}
