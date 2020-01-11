create or replace PACKAGE BODY IR_TO_MSEXCEL 
as
  SUBTYPE t_large_varchar2  IS VARCHAR2(32767);
  v_plugin_running boolean default false;

  -- public function to determine in apex that download was started 
  -- can be used to show certain columns in Excel only
  FUNCTION is_ir2msexcel 
  RETURN BOOLEAN
  IS
  BEGIN
    RETURN nvl(v_plugin_running,false);    
  END is_ir2msexcel;
  ------------------------------------------------------------------------------
  -- add lines from source code to error stack 
  -- needs to better identify the place where error happens
  FUNCTION convert_error_stack(p_error_stack in varchar2) 
  RETURN VARCHAR2 
  IS 
    v_str    VARCHAR2(32767);
    v_code_line_txt VARCHAR2(32767);
    v_package_and_line_no VARCHAR2(100);
    v_line_no  VARCHAR2(100);  
    v_package  VARCHAR2(100);
    v_schema   VARCHAR2(100);
  BEGIN
    v_str := p_error_stack;
    FOR i IN 1..4 LOOP -- it is enoght to have information about fist 4  places
      v_package_and_line_no := regexp_substr(v_str,'"[^"]+", \w+ \d+',1,i);
      
      v_line_no := ltrim(regexp_substr(v_package_and_line_no,' \d+'),' ');
      
      v_package := ltrim(rtrim(regexp_substr(v_package_and_line_no,'[.]\w+"'),'"'),'.');
      v_schema := ltrim(rtrim(regexp_substr(v_package_and_line_no,'"\w+[.]'),'.'),'"');
      
      BEGIN
        SELECT substr(regexp_replace(text,'\s+',' '),1,100)
        INTO v_code_line_txt
        FROM all_source 
        WHERE name = v_package 
          AND owner = v_schema
          AND type = 'PACKAGE BODY'
          AND line = v_line_no;
      EXCEPTION
        WHEN OTHERS THEN
          v_code_line_txt := '';
      END;
      
      v_str := replace(v_str,v_package_and_line_no,v_package_and_line_no||' <'||v_code_line_txt||'>');
    END LOOP;
    RETURN v_str;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN p_error_stack;
  END convert_error_stack;
  ------------------------------------------------------------------------------
  -- return APEX internal numeric region id
  FUNCTION get_affected_region_id(
    p_dynamic_action_id IN apex_application_page_da_acts.action_id%TYPE,
    p_static_id  IN VARCHAR2 -- region ID in HTML, string, can be defined by developer as Static ID
  )
  RETURN  apex_application_page_da_acts.affected_region_id%TYPE
  IS
    v_affected_region_id apex_application_page_da_acts.affected_region_id%TYPE;
  BEGIN
    -- first try to get affected region from setting of dynamic action
    SELECT affected_region_id
    INTO v_affected_region_id
    FROM apex_application_page_da_acts aapda
    WHERE aapda.action_id = p_dynamic_action_id
      AND page_id IN(nv('APP_PAGE_ID'),0)
      AND application_id = nv('APP_ID')
      AND ROWNUM <2; 
    -- otherwise  use ststic id    
    IF v_affected_region_id IS NULL THEN 
       -- static id can be defined by developer
      BEGIN 
        SELECT region_id 
        INTO v_affected_region_id 
        FROM apex_application_page_regions 
        WHERE  static_id = p_static_id
          AND page_id IN (nv('APP_PAGE_ID'),0)
          AND application_id = nv('APP_ID');
      EXCEPTION 
        WHEN no_data_found THEN   
         -- or can be generated automatically as 'R'||region_id
         SELECT region_id 
         INTO v_affected_region_id 
         FROM apex_application_page_regions 
         WHERE  region_id = to_number(ltrim(p_static_id,'R'))
           AND page_id IN (nv('APP_PAGE_ID'),0)
           AND application_id = nv('APP_ID'); 
      END; 
    END IF;       
    RETURN v_affected_region_id;
  EXCEPTION
    WHEN OTHERS THEN
      raise_application_error(-20001,'IR_TO_MSEXCEL.get_affected_region_id: No region found!');      
  END get_affected_region_id;
  ------------------------------------------------------------------------------
  -- get static id for region
  -- static id can be defined by developer
  -- or generated by APEX as 'R'||region_id
  FUNCTION get_affected_region_static_id(
    p_dynamic_action_id IN apex_application_page_da_acts.action_id%TYPE,
    p_type              IN VARCHAR2   
  )
  RETURN  apex_application_page_regions.static_id%TYPE
  IS
    v_affected_region_selector apex_application_page_regions.static_id%TYPE;
  BEGIN
      SELECT nvl(static_id,'R'||TO_CHAR(affected_region_id))
      INTO v_affected_region_selector
      FROM apex_application_page_da_acts aapda,
           apex_application_page_regions r
      WHERE aapda.action_id = p_dynamic_action_id
        AND aapda.affected_region_id = r.region_id
        AND r.source_type = p_type
        AND aapda.page_id = nv('APP_PAGE_ID')
        AND aapda.application_id = nv('APP_ID')
        AND r.page_id = nv('APP_PAGE_ID')
        AND r.application_id = nv('APP_ID');

      RETURN v_affected_region_selector;
  EXCEPTION
    WHEN no_data_found THEN
      RETURN NULL;
  END get_affected_region_static_id;
  ------------------------------------------------------------------------------
  
  FUNCTION get_apex_version
  RETURN VARCHAR2
  IS
   v_version VARCHAR2(3);
  BEGIN
     SELECT substr(version_no,1,3) 
     INTO v_version
     FROM apex_release
     WHERE ROWNUM <2;

     RETURN v_version;
  END get_apex_version;
  ------------------------------------------------------------------------------
  
  FUNCTION get_ig_file_name (p_region_selector IN VARCHAR2)
  RETURN VARCHAR2
  IS
    v_filename apex_appl_page_igs.download_filename%TYPE;
  BEGIN
    SELECT download_filename
      INTO v_filename
      FROM apex_appl_page_igs
    WHERE application_id = nv('APP_ID')
      AND page_id = nv('APP_PAGE_ID')
      AND nvl(region_name,'R'||region_id) = p_region_selector
      AND ROWNUM <2;

     RETURN apex_plugin_util.replace_substitutions(nvl(v_filename,'Excel'));
  EXCEPTION
    WHEN OTHERS THEN
       RETURN 'Excel';
  END get_ig_file_name;
  ------------------------------------------------------------------------------
  -- is used both for interactive grids and reports
  FUNCTION render (
    p_dynamic_action IN apex_plugin.t_dynamic_action,
    p_plugin         IN apex_plugin.t_plugin 
  )
  RETURN apex_plugin.t_dynamic_action_render_result
  IS
    v_javascript_code          VARCHAR2(1000);
    v_result                   apex_plugin.t_dynamic_action_render_result;
    v_plugin_id                VARCHAR2(100);
    v_affected_region_ir_selector apex_application_page_regions.static_id%TYPE;
    v_affected_region_ig_selector apex_application_page_regions.static_id%TYPE;
    v_is_ig                    BOOLEAN DEFAULT false;
    v_is_ir                    BOOLEAN DEFAULT false;
    v_workspace                apex_applications.workspace%TYPE;
    v_found                    BOOLEAN DEFAULT false;
  BEGIN
    v_plugin_id := apex_plugin.get_ajax_identifier;
    v_affected_region_ir_selector := get_affected_region_static_id(p_dynamic_action.id,'Interactive Report');
    v_affected_region_ig_selector := get_affected_region_static_id(p_dynamic_action.id,'Interactive Grid');

    SELECT workspace
    INTO v_workspace
    FROM apex_applications
    WHERE application_id = nv('APP_ID');

    -- add "Download XLSX" icon to the download - menu
    IF nvl(p_dynamic_action.attribute_03,'Y') = 'Y' THEN 
      IF v_affected_region_ir_selector IS NOT NULL THEN
        -- add XLSX Icon to Affected IR Region
        v_javascript_code :=  'excel_gpv.addDownloadXLSXIcon('''||v_plugin_id||''','''||v_affected_region_ir_selector||''','''||get_apex_version||''');';
        apex_javascript.add_onload_code(v_javascript_code,v_affected_region_ir_selector);
      ELSIF v_affected_region_ig_selector IS NOT NULL THEN
         -- add XLSX Icon to Affected IG Region
         v_javascript_code := 'excel_ig_gpv.addDownloadXLSXiconToIG('''||v_affected_region_ig_selector
           ||''','''||v_plugin_id||''','''||get_ig_file_name(v_affected_region_ig_selector)||''',''/'||ltrim(p_plugin.file_prefix,'/')||''');';  
         apex_javascript.add_onload_code(v_javascript_code,v_affected_region_ig_selector);
      ELSE
        -- add XLSX Icon to all IR and IR  Regions on the page
        FOR i IN (SELECT nvl(static_id,'R'||TO_CHAR(region_id)) AS affected_region_selector,
                         r.source_type
                  FROM apex_application_page_regions r
                  WHERE r.page_id = nv('APP_PAGE_ID')
                    AND r.application_id =nv('APP_ID')
                    AND r.source_type  IN ('Interactive Report','Interactive Grid')
                    AND r.workspace = v_workspace
                 )
        LOOP
           IF i.source_type = 'Interactive Report' THEN 
             v_javascript_code :=  'excel_gpv.addDownloadXLSXIcon('''||v_plugin_id||''','''||i.affected_region_selector||''','''||get_apex_version||''');';
             v_is_ir := true;
           ELSE             
             v_javascript_code := 'excel_ig_gpv.addDownloadXLSXiconToIG('''||i.affected_region_selector||''','''||v_plugin_id||''','''||get_ig_file_name(v_affected_region_ig_selector)||''',''/'||ltrim(p_plugin.file_prefix,'/')||''');';  
             v_is_ig := true;
           END IF;
           apex_javascript.add_onload_code(v_javascript_code,i.affected_region_selector);
        END LOOP;
      END IF;
    END IF;

    -- add libraries only if needed
    IF v_affected_region_ir_selector IS NOT NULL OR v_is_ir THEN
       apex_javascript.add_library (p_name      => 'IR2MSEXCEL', 
                                    p_directory => p_plugin.file_prefix); 
    END IF;                                 
    IF v_affected_region_ig_selector IS NOT NULL OR v_is_ig THEN
        apex_javascript.add_library (p_name      => 'IG2MSEXCEL', 
                                     p_directory => p_plugin.file_prefix); 
        apex_javascript.add_library (p_name      => 'shim.min', 
                                     p_directory => p_plugin.file_prefix); 
        apex_javascript.add_library (p_name      => 'blob.min', 
                                     p_directory => p_plugin.file_prefix);
        apex_javascript.add_library (p_name      => 'FileSaver.min', 
                                     p_directory => p_plugin.file_prefix);
    END IF;

    -- if affected region is defined add javaScript - code 
    -- to realize download functionality
    IF v_affected_region_ir_selector IS NOT NULL THEN
      -- for IR
      v_result.javascript_function := 'function(){excel_gpv.getExcel('''||v_affected_region_ir_selector||''','''||v_plugin_id||''')}';
    ELSIF v_affected_region_ig_selector IS NOT NULL THEN      
      -- for IG
      v_result.javascript_function := 'function(){excel_ig_gpv.downloadXLSXfromIG('''||v_affected_region_ig_selector||''','''||v_plugin_id||''','''||get_ig_file_name(v_affected_region_ig_selector)||''',''/'||ltrim(p_plugin.file_prefix,'/')||''')}';
    ELSE
      -- try to find first IR/IG on the page
      FOR i IN (SELECT nvl(static_id,'R'||TO_CHAR(region_id)) AS affected_region_selector,
                         r.source_type
                  FROM apex_application_page_regions r
                  WHERE r.page_id = nv('APP_PAGE_ID')
                    AND r.application_id =nv('APP_ID')
                    AND r.source_type  IN ('Interactive Report','Interactive Grid')
                    AND r.workspace = v_workspace
                    AND ROWNUM < 2
                 )
        LOOP
          IF i.source_type = 'Interactive Report' THEN
            v_result.javascript_function := 'function(){excel_gpv.getExcel('''||i.affected_region_selector||''','''||v_plugin_id||''')}';
          ELSE
            v_result.javascript_function := 'function(){excel_ig_gpv.downloadXLSXfromIG('''||i.affected_region_selector||''','''||v_plugin_id||''','''||get_ig_file_name(v_affected_region_ig_selector)||''',''/'||ltrim(p_plugin.file_prefix,'/')||''')}';
          END IF; 
          v_found := true;
        END LOOP;        
        IF NOT v_found THEN
          v_result.javascript_function := 'function(){console.log("No Affected Region Found!");}';
        END IF;  
    END IF;

    v_result.ajax_identifier := v_plugin_id;

    RETURN v_result;
  END render;

  ------------------------------------------------------------------------------
  --used for export in IG
  -- IG-Export needs to get some additional data from APEX DB
  -- these data can't be recieved using IG javascript API
  -- at least for older versions of APEX
  -- This function prepares all the data in json- format
  PROCEDURE print_column_properties_json(p_application_id IN NUMBER,
                                         p_page_id        IN NUMBER,
                                         p_rows_portion   IN NUMBER,
                                         p_max_rows       IN NUMBER
                                        )
  IS
    l_columns_cursor    SYS_REFCURSOR;
    l_highlihts_cursor  SYS_REFCURSOR;
    v_decimal_separator CHAR(1 CHAR);
    v_lang_code         CHAR(2 CHAR);
  BEGIN
    OPEN l_columns_cursor FOR 
    SELECT column_id,
           CASE 
            WHEN  data_type IN ('DATE','TIMESTAMP_TZ','TIMESTAMP_LTZ','TIMESTAMP') THEN 'DATE'
            ELSE data_type
           END data_type,
           name,
           CASE 
            WHEN  data_type IN ('DATE','TIMESTAMP_TZ','TIMESTAMP_LTZ','TIMESTAMP') THEN
                  ir_to_xlsx.convert_date_format_js(p_datatype => data_type, p_format => format_mask)
            ELSE ''
           END date_format_mask_js,
           CASE 
            WHEN  data_type IN ('DATE','TIMESTAMP_TZ','TIMESTAMP_LTZ','TIMESTAMP') THEN
                  ir_to_xlsx.convert_date_format(p_datatype => data_type,p_format => format_mask)
            ELSE ''
           END date_format_mask_excel,
           value_alignment,
           heading_alignment
    FROM apex_appl_page_ig_columns
    WHERE application_id = p_application_id 
      AND page_id = p_page_id
    ORDER BY display_sequence;

    OPEN l_highlihts_cursor FOR 
    SELECT highlight_id,
           background_color,
           text_color
    FROM apex_appl_page_ig_rpt_highlts
    WHERE application_id = p_application_id 
      AND page_id = p_page_id;

    SELECT substr(value,1,1)  AS decimal_seperator
    INTO v_decimal_separator
    FROM nls_session_parameters
    WHERE parameter = 'NLS_NUMERIC_CHARACTERS';

    -- always use 'AMERICA' as second parameter because 
    -- really i need only lang code (first parameter) and not the country
    SELECT regexp_substr(utl_i18n.map_locale_to_iso  (value, 'AMERICA'),'[^_]+')
    INTO v_lang_code
    FROM nls_session_parameters
    WHERE parameter = 'NLS_LANGUAGE';

    apex_json.initialize_clob_output;
    apex_json.open_object;
    apex_json.write('column_properties', l_columns_cursor);
    apex_json.write('highlights', l_highlihts_cursor);
    apex_json.write('decimal_separator', v_decimal_separator);
    apex_json.write('lang_code', v_lang_code);
    apex_json.write('rows_portion',p_rows_portion);
    apex_json.write('max_rows',p_max_rows);
    apex_json.close_object;
    sys.htp.p(apex_json.get_clob_output);
    apex_json.free_output;

    IF l_columns_cursor%isopen THEN
       CLOSE l_columns_cursor;
    END IF;
    IF l_highlihts_cursor%isopen THEN
       CLOSE l_highlihts_cursor;
    END IF;    
  END print_column_properties_json;
  ------------------------------------------------------------------------------

  function ajax (p_dynamic_action in apex_plugin.t_dynamic_action,
                 p_plugin         in apex_plugin.t_plugin )
  return apex_plugin.t_dynamic_action_ajax_result
  is
    p_download_type      varchar2(1);
    p_custom_width       t_large_varchar2;
	p_autofilter         char;
    p_export_links       char;
    v_maximum_rows       number;
    v_dummy              apex_plugin.t_dynamic_action_ajax_result;
    v_affected_region_id apex_application_page_da_acts.affected_region_id%type;
  begin
      v_plugin_running := true;
      --to get properties needed for export in IG
      if apex_application.g_x01 = 'G' then 
        print_column_properties_json(p_application_id => apex_application.g_x02,
                                     p_page_id        => apex_application.g_x03,
                                     p_rows_portion   => nvl(p_dynamic_action.attribute_07,1000),
                                     p_max_rows       => nvl(p_dynamic_action.attribute_01,1000)
                                     );
        return v_dummy;
      end if;  

      p_download_type := nvl(p_dynamic_action.attribute_02,'E');
      p_autofilter := nvl(p_dynamic_action.attribute_04,'Y');
      p_export_links := nvl(p_dynamic_action.attribute_05,'N');
      p_custom_width := p_dynamic_action.attribute_06;
      v_affected_region_id := get_affected_region_id(
        p_dynamic_action_id => p_dynamic_action.ID,
        p_static_id         => apex_application.g_x03
      );

      v_maximum_rows := nvl(apex_plugin_util.replace_substitutions(apex_plugin_util.replace_substitutions(p_dynamic_action.attribute_01)),
                                nvl(IR_TO_XLSX.get_max_rows (p_app_id    => apex_application.g_x01,
                                                             p_page_id   => apex_application.g_x02,
                                                             p_region_id => v_affected_region_id)
                                ,1000)); 
      ir_to_xlsx.download_excel(p_app_id        => apex_application.g_x01,
                                p_page_id      => apex_application.g_x02,
                                p_region_id    => v_affected_region_id,
                                p_col_length   => apex_application.g_x04,
                                p_max_rows     => v_maximum_rows,
                                p_autofilter   => p_autofilter,
                                p_export_links => p_export_links,
                                p_custom_width => p_custom_width
                                );
     return v_dummy;
  exception
    when others then
      raise_application_error(-20001,'Version:'||PLUGIN_VERSION||' '||convert_error_stack(SQLERRM||chr(10)||dbms_utility.format_error_backtrace));      
  end ajax;

end IR_TO_MSEXCEL;
/
