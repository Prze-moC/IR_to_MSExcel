(function(parent, $, undefined){
  
	if (parent.excel_ig_gpv === undefined) {

		parent.excel_ig_gpv = function () {

  function buildFormatObj(formatIn) {
	var formatObj = {};
	var format = formatIn || {};
	
	if(!format.colors) {
		format.colors = {};
	}
	
	if(format.colors.backColor) {
		formatObj.fill = { fgColor : { rgb: "FF" + format.colors.backColor.replace("#","") }};		
	}
	if(format.colors.color) {
		formatObj.font = { color : { rgb: "FF" + format.colors.color.replace("#","") }};		
	}
	if(format.align) {				
		if (format.align === "start") {
			formatObj.alignment = { horizontal : "left" }		
		} else if (format.align === "end") {
			formatObj.alignment = { horizontal : "right" }		
		} else {
			formatObj.alignment = { horizontal : format.align }		
		}			
	}	
		
	return  formatObj;
}


function getCellDate(value,colDataType,langCode,format,moment) {
  var cell = {v : value,
							s :  buildFormatObj(format)
						 };
	var formatMask = colDataType.formatMask;
	var dateStrict = !( formatMask.search("MMMM") >= 0 || formatMask.search("ddd") >= 0 ); //because of bug https://github.com/moment/moment/issues/4227	
	var langCode = langCode || 'en';		
	var parsedDate = moment(value,formatMask,langCode,dateStrict);		
	var epoch = new Date(1899,11,31);
	
	if(value) {
		if( parsedDate.isValid()) {
			cell.t = 'n'; // excel recognizes date as number that have a date format string			
			cell.z = colDataType.formatMaskExcel;						
			cell.v = ((parsedDate.toDate() - epoch) / (24 * 60 * 60 * 1000)) + 1;			// + 1 because excel leap bug
		}	
	 else {
		 console.log("Can't parse date <" + value + "> with format <" + formatMask + "> strict:" + dateStrict);
		 cell.t = 's';	 
	 }
	}
 return cell;
}


function getCellNumber(value,colDataType,decimalSeparator,format) {	
	var cell = {};
	if (typeof value === 'object') {		
		cell.t = 's';	 
	  cell.v = value.d;
		return cell;
	} else if (typeof value !== 'string') {		
		cell.t = 's';	 
	  cell.v = String(value);
		return cell;
	}
	
	var num; 
  var re = new RegExp("[^0123456789" + decimalSeparator +"]","g");	
	var str = "" + value;
	cell.v = str; 
	cell.s = buildFormatObj(format);
	
	if(value) {
    str.replace(re, ""); //remove all symbols except digits and decimalSeparator		
		str = str.replace(decimalSeparator, "."); //change decimalSeparator to JS-decimal separator
		num = parseFloat(str);			
		if( !isNaN(num) ) {
			cell.t = 'n';	  
			cell.z = colDataType.formatMaskExcel;
			cell.v = num;				
		} else if (str.charAt(0) === "t") { //do not display ID's generated by IG
			cell.t = 's';	 
			cell.v = "";					 
		} else {
			console.log("Can't parse number <" + value + ">");
			cell.t = 's';	 
			cell.v = value;	
		}
	}
 return cell;
}

function getCellChar(value,format) {
	if (typeof value === 'object') {
		return  {v: value.d,
		  			 t: 's',
			  		 s :  buildFormatObj(format)
				   };
	} else if (typeof value !== 'string') {		
	  return  {v: String(value),
	          t: 's'
				   };		
	} else {
	  return  {v: value,
		  			 t: 's',
			  		 s :  buildFormatObj(format)
				   };
	}	
}


function recalculateRangeAndGetCellAddr(range,colNo,rowNo) {
	// recalculate column range	
	if(range.s.c > colNo) range.s.c = colNo;				
	if(range.e.c < colNo) range.e.c = colNo;
	// recalculate row range		
	if(range.s.r > rowNo) range.s.r = rowNo;
	if(range.e.r < rowNo) range.e.r = rowNo;
	
	return XLSX.utils.encode_cell({c:colNo,r:rowNo});
	
}

function getHighlight(id,highlights) {
	var colors = {};
	for(i = 0; i < highlights.length; i++ ) {
		if(highlights[i].HIGHLIGHT_ID == id) {
			   colors.backColor = highlights[i].BACKGROUND_COLOR;
			   colors.color = highlights[i].TEXT_COLOR;
			   break;
			 }
	}
	return colors;
}

function getWorksheet(data,properties) {		
	var ws = { "!cols" : [],
					   "!autofilter" : []
					 };
	var range = {s: {c:10000000, r:10000000}, e: {c:0, r:0 }};
	var rangeStr;
	var cellAddr = {}; 
	var cell = {};
	var R,C,I,A; // iterators
  var columnNum; 
	var rowNum = 0;
	var colDataTypesArr = properties.columnsProperties;
	var isControlBreak = properties.haveControlBreaks;
	var rowAdditionalnfo;
	var controlBreakArr = [];
	var startColumn = properties.hasAggregates ? 1 : 0; 
	var cellFormat = {};
	var rowColors = {};	
	var dataIndex;

	// print headers
	for(I = 0; I < colDataTypesArr.length; I++) {
		columnNum = colDataTypesArr[I].displayOrder;
		if( columnNum < 1000000 ) {					
			cell = getCellChar(colDataTypesArr[I].heading,{align : colDataTypesArr[I].headingAlignment,
																										 colors: {
																											  backColor : "C4D79B"
																										 }
																										});		  
			cellAddr = recalculateRangeAndGetCellAddr(range,columnNum  + startColumn,rowNum);
			ws[cellAddr] = cell;
			// set column width
			ws['!cols'].push({wch:colDataTypesArr[I].width/6}); // 6 - is a WIDTH_COEFFICIENT	
		}	
	};
	rowNum++;
	
	//print data
	for(R = 0; R < data.length; R++) { // rows
		rowAdditionalnfo = data[R][data[R].length - 1] || {}; // last record is an object with additional proprties						
		cellFormat = { colors : {}};
		if(rowAdditionalnfo.highlight) {
			rowColors = getHighlight(rowAdditionalnfo.highlight,properties.highlights);			
		}			
		else {
			rowColors = {};
		}
		
		// display control break		
		if( isControlBreak && (!rowAdditionalnfo.agg) )  { 
			for(C = 0; C < data[R].length; C++) {			//columns 
				columnNum = colDataTypesArr[C].displayOrder;
				dataIndex = colDataTypesArr[C].index;
				if( columnNum > 1000000 ) {			//is control break
					controlBreakArr.push({ displayOrder : columnNum,
															   text : colDataTypesArr[C].heading + " : " + data[R][dataIndex]
															 });
				} // end column loop
			}
		  cellAddr = recalculateRangeAndGetCellAddr(range,startColumn,rowNum); 
			// sort contol break columns in display order and convert them to the simple array of strings
			controlBreakArr = controlBreakArr.sort(function(a,b){
				return a.displayOrder - b.displayOrder;
			}).map(function(a){
				return a.text;
			});			
			cell = getCellChar(controlBreakArr.join(", "));				
			ws[cellAddr] = cell;
			rowNum++;							
			controlBreakArr = [];
		} 		
		// display regular columns		
		for(C = 0; C < data[R].length - 1; C++) {			//columns; -1 because last record is an object with additional proprties
		  cellFormat.align = colDataTypesArr[C].alignment;
			// do not show highlights for aggregations
			if ( !rowAdditionalnfo.agg ) {
			  cellFormat.colors = rowColors;	
			} else {
				cellFormat.colors = {};
			}							
			columnNum = colDataTypesArr[C].displayOrder;
			dataIndex = colDataTypesArr[C].index;			
			if( columnNum < 1000000 ) {			//display visible columns	
				cellAddr = recalculateRangeAndGetCellAddr(range,columnNum + startColumn,rowNum); 				
				// show cell highlights
				if(rowAdditionalnfo.fields) {
					if(rowAdditionalnfo.fields[colDataTypesArr[C].name]) {						
						if (rowAdditionalnfo.fields[colDataTypesArr[C].name].highlight) {
						 cellFormat.colors = getHighlight(rowAdditionalnfo.fields[colDataTypesArr[C].name].highlight,properties.highlights);			
						}	
					}
				} 
				
				if(colDataTypesArr[C].dataType == 'NUMBER') {
					cell = getCellNumber(data[R][dataIndex],colDataTypesArr[C],properties.decimalSeparator,cellFormat)
				} else if(colDataTypesArr[C].dataType == 'DATE') {				
					cell = getCellDate(data[R][dataIndex],colDataTypesArr[C],properties.langCode,cellFormat,properties.moment);
				} else {
					// string
					cell = getCellChar(data[R][dataIndex],cellFormat);
				}					
				ws[cellAddr] = cell;
			} 
		} // end column loop		
		cellFormat.colors = {};
		// aggregations
		if(rowAdditionalnfo.agg) {
			// print name of aggregation in the first column
			if(rowAdditionalnfo.grandTotal) {
			  cell = getCellChar(properties.aggregateLabels[rowAdditionalnfo.agg].overallLabel);	
			} else {
				cell = getCellChar(properties.aggregateLabels[rowAdditionalnfo.agg].label);	
			}
			cellAddr = recalculateRangeAndGetCellAddr(range,0,rowNum); 
			ws[cellAddr] = cell;
		} else {
		  isControlBreak = rowAdditionalnfo.endControlBreak || false;			
		}
		rowNum++;				
	} // end row loop	
	
	
	rangeStr = XLSX.utils.encode_range(range); // to do: clarify			
	if(range.s.c < 10000000) { 		
		ws['!ref'] = rangeStr; 
		ws['!autofilter'] = { ref: rangeStr }; // not working on my PC -(
	}
	
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

function getRows(iGrid,propertiesFromPlugin,callback,fileName,pathIn) {
  var rows = [];		
	var gridView = iGrid.interactiveGrid("getViews").grid; 
	var model = gridView.model;
	var count = model.getOption("pageSize");  		
	var config; //requirejs config
	var packages; // requirejs config.packages	
	var path=$("script[src$='IG2MSEXCEL.js']").attr("src").replace('IG2MSEXCEL.js',''); 	
	var localPath;
  
	if(path.charAt(0) === "/") {
		 path = document.location.origin + path;
	} else {
     var localPath = document.location.origin + document.location.pathname; 
     localPath = localPath.replace(/f$/, '');
		 path = localPath + path;
	}

	//https://community.oracle.com/thread/4014257  
	function loadBatchOfRecords(model, offset, count) {  
			var i = 0;  					  
			model.forEachInPage(offset, count, function(r) {  
					i += 1;  
				  if(r)  {						
						rows.push(r);  				
					}				
					if (i === count || !r) {  						
							// got all the records we asked for or no more available  
							if (r) {  								  								  								
									// if there are more recorda available get them  
									loadBatchOfRecords(model, offset + count, count);  
							}  else {								
								// load large JS-libraries dynamically using requirejs
								config = requirejs.s.contexts._.config; //get current config
                // add own settings for xlsx-js
								config.shim.xlsx = {
                                    deps: ['jszip'],
                                    exports: 'XLSX'
                };							 
               config.paths.xlsx = path + 'xlsx.full.min';
               config.paths.jszip = path + 'jszip.min';							 
								
							 // 	add moment.js								
							 config.moment = {
                 noGlobal: true
               };
 							 config.paths.moment = path + 'moment-with-locales';
							 config.packages = packages;
               requirejs.config(config);
               require(['jszip'], function (jszip) {
                     window.JSZip = jszip;
                     require(['xlsx','moment'], function (xlsx,moment) {											    											    
											    callback(rows,iGrid,propertiesFromPlugin,fileName,path,moment);		
                     });
              });								
						 }								
					}  
			 });  
	}  	

	loadBatchOfRecords(model, 0, count);	
}

function getPreparedIGProperties(columns,propertiesFromPlugin) {
	// all regular columns have displayOrder < 1000000 
	// all hidden columns have displayOrder = 1000000
	// all control breakcolumns have displayOrder > 1000000
	
	var I; //iterator
	var currColumnNo = 0;
	var controlBreakColumnNo = 1000001;
	var colProp = propertiesFromPlugin.column_properties;
	var haveControlBreaks = false;		
	
	// assign to the each data column a corresponding column number in excel 
	//
	// first sort columns in display order
	var displayInColumnArr = columns.map(function(a) { 		
		haveControlBreaks = (a.controlBreakIndex || haveControlBreaks) ? true : false;		
		return  {index : a.index, 
						 displayOrder : (a.hidden || a.property === "APEX$ROW_ACTION") ? (1000000 + (a.controlBreakIndex || 0)): a.seq, //to place hidden and control break columns at the end after sorting
						 heading: a.heading,
						 headingAlignment: a.headingAlignment,
						 alignment : a.alignment,
						 width: a.curWidth,
						 dataType    : "VARCHAR2",
						 formatMask : "",
						 formatMaskExcel : "",
						 name : a.property,
						 id : a.id,
						 controlBreakIndex : a.controlBreakIndex,
						 hidden : a.hidden
						};		
	 }).sort(function(a, b) { 
    return a.displayOrder - b.displayOrder;
   });	
	
	// second renumerate display order - skip hidden columns
	for(I = 0; I < displayInColumnArr.length; I++) { // regular row
		if(displayInColumnArr[I].displayOrder < 1000000) {
		  displayInColumnArr[I].displayOrder = currColumnNo;
			currColumnNo++;
		}	else if (displayInColumnArr[I].controlBreakIndex) { // control break row
			displayInColumnArr[I].displayOrder = controlBreakColumnNo;
			controlBreakColumnNo++;
		}
	}		

	
  // third sort columns in the data order
	displayInColumnArr.sort(function(a, b) { 
    return a.index - b.index;
   });
	
	// add additional data from server to the colHeader (map by column id)
	displayInColumnArr.forEach(function(val,index) {
		var b; // iterator
		for(b = 0; b < colProp.length; b++) {			
			if(val.id == colProp[b].COLUMN_ID) {				
				val.dataType = colProp[b].DATA_TYPE;
				val.formatMask = colProp[b].DATE_FORMAT_MASK_JS;
				val.formatMaskExcel = colProp[b].DATE_FORMAT_MASK_EXCEL;		
				break;
			}				
		}		
	});
	
	return { columnsProperties : displayInColumnArr,
					 decimalSeparator: propertiesFromPlugin.decimal_separator,
					 langCode : propertiesFromPlugin.lang_code,
					 haveControlBreaks : haveControlBreaks,
					 highlights : propertiesFromPlugin.highlights,
					 hasAggregates : false,
					 aggregateLabels : {}
				 };
}


function hasAggregates(rows) {
  // if aggregates exists last row always shows aggregates
	var lastRecord = rows[rows.length -1] || [];
	var rowAdditionalnfo = lastRecord[lastRecord.length -1] || {};
	return rowAdditionalnfo.agg ? true : false;
}


function buildExcel(rows,iGrid,propertiesFromPlugin,fileName,path,moment) {  
	var currentIGView = iGrid.interactiveGrid("getCurrentView");
	var	ws_name = currentIGView.model.name;
	var wb = new Workbook(); 
	var ws;
	var wbout;	  
  var columnPropertiesFromIG = currentIGView.view$.grid("getColumns");	
	var properties = getPreparedIGProperties(columnPropertiesFromIG,propertiesFromPlugin);  	
	
	properties.hasAggregates = hasAggregates(rows);
	properties.aggregateLabels = iGrid.interactiveGrid("getViews").grid.aggregateLabels;
	properties.moment = moment;
	ws = getWorksheet(rows,properties); 	
	
	//return;  
	// add worksheet to workbook 
	wb.SheetNames.push(ws_name);
	wb.Sheets[ws_name] = ws;	
	wbout = XLSX.write(wb, {bookType:'xlsx', bookSST:true, type: 'binary'});

	saveAs(new Blob([s2ab(wbout)],{type:"application/octet-stream"}), fileName  + ".xlsx");		
}

function addDownloadXLSXiconToIG(vRegionID,vPluginID,fileName,path) {
  try {
  if(!apex.region(vRegionID)) {
    return;
  }
	var vWidget$ = apex.region(vRegionID).widget();
  var toolbar = vWidget$.interactiveGrid("getToolbar");

  // find toolbar group
  var toolbarGroup = toolbar.toolbar('findGroup', "actions4");
  var buttonExists = false;
  for (var i=0;i<toolbarGroup.controls.length;i++) {
   if(toolbarGroup.controls[i].action === "GPVGETXLSX")
    {
     buttonExists = true;
    }
  }
 	
  if(!buttonExists) {
  	toolbarGroup.controls.push({
		type: 'BUTTON',
		label: "XLSX",
		title: "XLSX",
		labelKey: "XLSX", // label from text messages
		action: "GPVGETXLSX",
		icon: "icon-ig-download",
		iconOnly: false,
		iconBeforeLabel: true,
		hot: false
	});
  }	
	// add actions
	var vActions = vWidget$.interactiveGrid('getActions');

	// check if action exists, then just assign it
	var vAction$ = vActions.lookup("GPVGETXLSX");
	if(!vAction$){
		vActions.add(
			{
				name   : "GPVGETXLSX"
				, action : function(event, element) {					
					var mySpinner = apex.widget.waitPopup();
					apex.server.plugin ( vPluginID, 
                                        {x01: "G",
                                         x02: $v("pFlowId"),
                                         x03: $v("pFlowStepId")
                                        },                                   
                                        {success: function(propertiesFromPlugin){																
                                             getRows(vWidget$,propertiesFromPlugin,buildExcel,fileName,path);		
                                        }                                  
                                        }); 
				 mySpinner.remove();
				}
				, hide : false
				, disabled : false
			});
	}else{
		vAction$.hide = false;
		vAction$.disabled = false;
	}
    
  // refresh grid
  toolbar.toolbar('refresh');

	} catch(err) {
		console.log(err);
	}	
}	
	
function downloadXLSXfromIG(vRegionID,vPluginID,fileName,path) {
	var vWidget$ = apex.region(vRegionID).widget();
	var mySpinner = apex.widget.waitPopup();
	apex.server.plugin ( vPluginID, 
											{x01: "G",
											 x02: $v("pFlowId"),
											 x03: $v("pFlowStepId")
											},                                   
											{success: function(propertiesFromPlugin){																
												getRows(vWidget$,propertiesFromPlugin,buildExcel,fileName,path);		
											}                                  
											}); 
  mySpinner.remove();	
}
//end
			
      return {
        addDownloadXLSXiconToIG:addDownloadXLSXiconToIG
      , downloadXLSXfromIG: downloadXLSXfromIG
      };
			
		}();
	}
})(window, apex.jQuery)			