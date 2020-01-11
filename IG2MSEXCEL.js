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

function getAPEXVersion() {
  // get first <script> HTML tag where version v= is set
  // like <script type="text/javascript" src="/i/libraries/jquery/2.2.3/jquery-2.2.3.min.js?v=5.1.4.00.08">
  var str = $("script").filter(function(i,e){ return e.src.search("v=") > 0})[0].src;
  // get version as string: 5.1.4.00.08
  str = str.substr(str.search("v=")+2);
  // get first 2 digit 
  var version_arr = str.match(/\d+[.]\d+/) || [""];
  return version_arr[0];  
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
                        var dateParsed = parsedDate.toDate();
      cell.t = 'n'; // excel recognizes date as number that have a date format string     
      cell.z = colDataType.formatMaskExcel;           
      cell.v = ((dateParsed - epoch + epoch.getTimezoneOffset()*60*1000 - dateParsed.getTimezoneOffset()*60*1000) / (24 * 60 * 60 * 1000)) + 1;     // + 1 because excel leap bug
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
  var re = new RegExp("[^-0123456789" + decimalSeparator +"]","g"); 
  var str = "" + value;
  cell.v = str; 
  cell.s = buildFormatObj(format);
  
  if(value) {
                str = str.replace(re, ""); //remove all symbols except digits and decimalSeparator    
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
      console.log("Can't parse number <" + value + "> str=" + str);
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
      for(C = 0; C < data[R].length; C++) {     //columns 
        columnNum = colDataTypesArr[C].displayOrder;
        dataIndex = colDataTypesArr[C].index;
        if( columnNum > 1000000 ) {     //is control break
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
    for(C = 0; C < data[R].length - 1; C++) {     //columns; -1 because last record is an object with additional proprties
      cellFormat.align = colDataTypesArr[C].alignment;
      // do not show highlights for aggregations
      if ( !rowAdditionalnfo.agg ) {
        cellFormat.colors = rowColors;  
      } else {
        cellFormat.colors = {};
      }             
      columnNum = colDataTypesArr[C].displayOrder;
      dataIndex = colDataTypesArr[C].index;     
      if( columnNum < 1000000 ) {     //display visible columns 
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
          cell = getCellNumber(data[R][dataIndex],colDataTypesArr[C],properties.decimalSeparator,cellFormat);
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

  function showCountInSpinner(cnt) {
    // concept - functionality
    //
    // The Spinner will automatically shown by calling 
    // APEX forEachInPage - function.
    // That menas i don't have control on it. 
    // Only one way i found is to generally modify css 
    // and add rows count as "content"
    // Only one possibility to center the rows count i found
    // is to assign margin-left dynamically 
    // 5 is average brite of the character 
    if(cnt > 0) {
      $("#ir-to-ms-excel-spinner").remove();
      $("<style id='ir-to-ms-excel-spinner'>")
      .prop("type", "text/css")
      .html("\
      .u-Processing::after {\
        content: '" + cnt + "';\
        margin-left: -" + (cnt.toString().length * 5 ) + "px; \
      }")
      .appendTo("head");
    } else {
       $("#ir-to-ms-excel-spinner").remove();
    }
  }
  

  //https://community.oracle.com/thread/4014257  
  function loadBatchOfRecords(model, offset, count, maxCount) {  
      var i = 0;              
      var cnt; // rows count to fetch in current step
      if (offset + count <= maxCount ) {
        cnt = count;
      }  else { 
        cnt = Math.min(count,maxCount - offset); 
      };      
      model.forEachInPage(offset, cnt, function(r) {            
          i += 1;  
          if(r)  {            
            rows.push(r);                   
          }       
          if (i === cnt || !r) {
            $spinner = $(".u-Processing");
            showCountInSpinner(rows.length);
              // got all the records we asked for or no more available  
              if (r && rows.length < maxCount) {                                                      
                  // if there are more records available - > get them  
                  loadBatchOfRecords(model, offset + cnt, cnt,maxCount);  
              }  else {             
                // remove count from spinner  
                showCountInSpinner(0);
                // ans starting converting data into XLSX 
                // first load large JS-libraries dynamically using requirejs
                config = requirejs.s.contexts._.config; //get current config
                // add own settings for xlsx-js
                config.shim.xlsx = {
                                    deps: ['jszip'],
                                    exports: 'XLSX'
                };               
               config.paths.xlsx = path + 'xlsx.full.min';
               config.paths.jszip = path + 'jszip.min';              
                
               //   add moment.js               
               config.moment = {
                 noGlobal: true
               };
               config.paths.moment = path + 'moment-with-locales';
               config.packages = packages;
               requirejs.config(config);
               require(['jszip'], function (jszip) {
                     window.JSZip = jszip;
                     require(['xlsx','moment'], function (xlsx,moment) {      
                          // call callback function => should be "buildExcel" - function
                          callback(rows,iGrid,propertiesFromPlugin,fileName,path,moment);   
                     });
              });               
             }                
          }  
       });  
  }   
  loadBatchOfRecords(model, 0, propertiesFromPlugin.rows_portion,propertiesFromPlugin.max_rows);  
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
    } else if (displayInColumnArr[I].controlBreakIndex) { // control break row
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
           aggregateLabels : {},
           max_rows : propertiesFromPlugin.max_rows,
           rows_portion : propertiesFromPlugin.rows_portion
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
  var ws_name = currentIGView.model.name;
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

      function addDownloadXLSXiconToIG(vRegionID, vPluginID, fileName, path) {
        if (!apex.region(vRegionID)) {
          return;
        }
        var vWidget$ = apex.region(vRegionID).widget();
        var vActions = vWidget$.interactiveGrid('getActions');
        var APEX5_1_class = "";
        var APEX18_1_class_exclude = " ir-to-ms-excel-block-w-button-height ";
        var APEXVersion = getAPEXVersion();

        if(APEXVersion == "5.1") {
          APEX5_1_class = " ui-state-default ";         
        }
       
        if(APEXVersion == "18.1" || APEXVersion == "18.0") {
          APEX18_1_class_exclude = "";         
        }
        
        
        $('body').on('dialogopen', function (event, ui) {         
          var $dialog = $(event.target);          
          //var $dialog_instance = $dialog.dialog("instance"); // do not work in APEX 5.2
          if (!(event.target.id == (vRegionID + '_ig_download-dialog') || event.target.id == (vRegionID + '_ig_download_dialog'))) {
            return;
          }
          if($dialog.parent().find('span.ui-dialog-title').text() !== apex.lang.getMessage( "APEXIR_DOWNLOAD")) {
            return; 
          }  
          // add button to the modal page
          // because inner html not exists at this moment
          // only one possibility i found is add a  div with position:absolute; 
          // to show the button on the right side
          if ($dialog.parent("div").find('.ir-to-ms-excel-block-w-button').length == 0) {   
            if(apex.region(vRegionID).widget().interactiveGrid("option").config.features.download.formats[0]==="") { // old syntax to keep compability with APEX 5.1.4
              $dialog.append('<style> div.ui-dialog-buttonset button.ui-button--hot { \
                              display: none; \
                              } </style>'); 
            }
            /*ui-state-default*/
            $dialog.parent("div").append('<div class="ir-to-ms-excel-block-w-button ' + APEX18_1_class_exclude + '">');
            var $button = $(".ui-button--hot").clone();
            $button.addClass('ir-to-ms-excel-button');
            var span_inside_button = $button.find("span");
            if(span_inside_button.length) {
              $(span_inside_button).text('XLSX');  
            } else {
              $button.text('XLSX');
            };
            /*$button.prepend('<span class="a-IGDialog-iconList-icon a-Icon icon-ig-dl-xls ir-to-ms-excel-block-icon" aria-hidden="true"></span>');*/
            $( ".ir-to-ms-excel-block-w-button").prepend($button);

            $('.ir-to-ms-excel-button').click(function () {               
              vActions.invoke("GPVGETXLSX");
              $dialog.dialog('close');
            });
          }         
        });

  // add actions
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