/*
 * This is a JavaScript Scratchpad.
 *
 * Enter some JavaScript, then Right Click or choose from the Execute Menu:
 * 1. Run to evaluate the selected text (Ctrl+R),
 * 2. Inspect to bring up an Object Inspector on the result (Ctrl+I), or,
 * 3. Display to insert the result in a comment after the selection. (Ctrl+L)
 */

function getCellDate(value,colDataType,langCode) {
  var cell = {v: value};
	var formatMask = colDataType.formatMask;
	var dateStrict = !( formatMask.search("mmmm") > 0 || formatMask.search("ddd") > 0 ); //because of bug https://github.com/moment/moment/issues/4227
	var langCode = langCode || 'en';	
	var parsedDate = moment(value,formatMask,langCode,dateStrict);
	
	if(value) {
		if( parsedDate.isValid()) {
		 //console.log(moment(cell.v,colDataTypesArr[C].formatMask,true).toDate());
			cell.t = 'n'; // excel recognizes date as number that have a date format string			
			cell.z = colDataType.formatMaskExcel;
			cell.v = (parsedDate.toDate() - new Date(Date.UTC(1899, 11, 30))) / (24 * 60 * 60 * 1000);
		}	
	 else {
		 console.log("Can't parse date <" + value + "> with format <" + formatMask + "> strict:" + dateStrict);
		 cell.t = 's';	 
	 }
	}
 return cell;
}


function getCellNumber(value,colDataType,decimalSeparator) {	
	var num; 
  var re = new RegExp("[^0123456789" + decimalSeparator +"]","g");	
	var str = "" + value;
	var cell = {v: str};
	
	if(value) {
    str.replace(re, ""); //remove all symbols except didits and decimalSeparator		
		str.replace(decimalSeparator, "."); //change decimalSeparator to JS-decimal separator
		num = parseFloat(str);	
		if( !isNaN(num) ) {
			cell.t = 'n';	  
			cell.z = colDataType.formatMaskExcel;
			cell.v = num;	
		} else {
			console.log("Can't parse number <" + value + ">");
			cell.t = 's';	 
			cell.v = val;	
		}
	}
 return cell;
}

function sheet_from_array_of_arrays(data, colDataTypesArr,decimalSeparator,langCode) {	
	//console.log(colDataTypesArr);
	var ws = {};
	var range = {s: {c:10000000, r:10000000}, e: {c:0, r:0 }};
	var cellAddr; 
	var cell = {};
	var R,C; // iterators
  var columnNum; 
	
	for(R = 0; R < data.length; R++) { // rows
    columnNum = 0;
		// recalculate row range		
		if(range.s.r > R) range.s.r = R;
		if(range.e.r < R) range.e.r = R;

		for(C = 0; C < data[R].length; C++) {			//columns
			columnNum = colDataTypesArr[C].displayOrder;
			if( columnNum < 1000000 ) {								
        // recalculate column range		
				if(range.s.c > columnNum) range.s.c = columnNum;				
				if(range.e.c < columnNum) range.e.c = columnNum;

				cellAddr = XLSX.utils.encode_cell({c:columnNum,r:R});

				if(colDataTypesArr[C].dataType == 'NUMBER') {
					cell = getCellNumber(data[R][C],colDataTypesArr[C],decimalSeparator)
				} else if(colDataTypesArr[C].dataType == 'DATE') {				
					cell = getCellDate(data[R][C],colDataTypesArr[C],langCode);
				} else {
					// string
					cell = {v: data[R][C],t: 's'};				
				}	

				ws[cellAddr] = cell;
				columnNum++; 
			}
		}
	}
	if(range.s.c < 10000000) ws['!ref'] = XLSX.utils.encode_range(range);
	return ws;
}

function Workbook() {
	if(!(this instanceof Workbook)) return new Workbook();
	this.SheetNames = [];
	this.Sheets = {};
}

function s2ab(s) {
	var buf = new ArrayBuffer(s.length);
	var view = new Uint8Array(buf);
	for (var i=0; i!=s.length; ++i) view[i] = s.charCodeAt(i) & 0xFF;
	return buf;
}

function getRows(iGrid) {
  var rows = [];
	
	iGrid.model.forEach(function (row_in) { 
		//console.log(row_in);
		var row = row_in.slice();      // make a copy of row
		var rowProperties = row.pop(); // properties a saved at the end of array

		if(rowProperties) {
			if(rowProperties.endControlBreak) {
				 rows.push([row[0]]);      
			}
		}  
		rows.push(row);  
  })	
  return rows;	
}

function getColumnsDataTypeArray(columns,colProp) {  
	var I; //iterator
	var currColumnNo = 0;
	// sort columns in order data comes from server 
	columns.sort(function(a, b) { 
    return a.index - b.index;
   })
	
	// assign to the each data column a corresponding column number in excel 
	// first sort columns in display order
	var displayInColumnArr = columns.map(function(a) { 
     if(a.hidden) {
			 return {dataOrder : a.index, displayOrder : 1000000, hidden: a.hidden, name : a.property};			 
		 } else {
			 return {dataOrder : a.index, displayOrder : a.seq, hidden: a.hidden, name : a.property}; 
		 }		 
	 }).sort(function(a, b) { 
    return a.displayOrder - b.displayOrder;
   });
	// second renumerate columns	
	for(I = 0; I < displayInColumnArr.length; I++) {
		if(displayInColumnArr[I].displayOrder < 1000000) {
		  displayInColumnArr[I].displayOrder = currColumnNo;
			currColumnNo++;
		}	
	}	
	//third sort in the order data comes from the server 
	displayInColumnArr.sort(function(a, b) { 
    return a.dataOrder - b.dataOrder;
   });
	
	
	//console.log(displayInColumnArr);
	//console.log(columns);
	//console.log(colProp);
	
	var columnsDataType = [];	
	var colDataType = {};
	for(var i = 0; i < columns.length; i++) {
		colDataType = { dataType    : "VARCHAR2",
									  formatMask : "",
									  formatMaskExcel : "",
									  name : "",
									  displayOrder : displayInColumnArr[i].displayOrder
									};	  
		for(var b = 0; b < colProp.length; b++) {			
			if(columns[i].id == colProp[b].COLUMN_ID) {				
				colDataType.dataType = colProp[b].DATA_TYPE;
				colDataType.formatMask = colProp[b].DATE_FORMAT_MASK_JS;
				colDataType.formatMaskExcel = colProp[b].DATE_FORMAT_MASK_EXCEL;
				colDataType.name = colProp[b].NAME;
			}				
		}
   columnsDataType.push(colDataType);	
	}
	return columnsDataType;
}

/* main code */

function main(columnPropertiesFromServer) {
	var iGrid = apex.region("IG").widget().interactiveGrid("getCurrentView");
	var columns = iGrid.view$.grid('getColumns');
	var	ws_name = iGrid.model.name;
	var wb = new Workbook(); 
	var ws;
	var wbout;
	var rows = getRows(iGrid);	
	//console.log(rows);
	//console.log(columns);
	
	var colDataTypesArr = getColumnsDataTypeArray(columns,columnPropertiesFromServer.column_properties);  //ordered in the order in which the columns comes from the server
	console.log(colDataTypesArr);
	//console.log(columnPropertiesFromServer);
	
	
	ws = sheet_from_array_of_arrays(rows,
																	colDataTypesArr,
																	columnPropertiesFromServer.decimal_seperator,
																	columnPropertiesFromServer.lang_code
																 ); 
	// add worksheet to workbook 
	//return;
	wb.SheetNames.push(ws_name);
	wb.Sheets[ws_name] = ws;
	wbout = XLSX.write(wb, {bookType:'xlsx', bookSST:true, type: 'binary'});

	saveAs(new Blob([s2ab(wbout)],{type:"application/octet-stream"}), "test.xlsx");

}

getColumnsProperties(main);






