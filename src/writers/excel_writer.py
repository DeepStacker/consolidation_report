import os
import openpyxl
import pandas as pd
from datetime import datetime, date, time
import re
from typing import Dict, List, Any
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter
from src.models.domain_models import SheetDefinition, SchemaDefinition


def format_cell(cell, font_name="Calibri", font_size=11, bold=False, italic=False, color="000000",
                alignment=None, fill=None, border=None, number_format=None):
    cell.font = Font(name=font_name, size=font_size, bold=bold, italic=italic, color=color)
    if alignment:
        cell.alignment = alignment
    if fill:
        cell.fill = fill
    if border:
        cell.border = border
    if number_format:
        cell.number_format = number_format


def _union_sheet_columns(schemas: List[SchemaDefinition], sheet_name: str) -> List[str]:
    all_cols = []
    seen = set()
    for s in schemas:
        if sheet_name in s.sheets:
            for c in s.sheets[sheet_name].columns:
                if c.canonical_name not in seen:
                    seen.add(c.canonical_name)
                    all_cols.append(c.canonical_name)
    return all_cols


def _first_sheet_def(schemas: List[SchemaDefinition], sheet_name: str) -> SheetDefinition:
    for s in schemas:
        if sheet_name in s.sheets:
            return s.sheets[sheet_name]
    return None


def _header_name(col_name: str, columns: List) -> str:
    for c in columns:
        if c.canonical_name == col_name:
            return c.header_name or c.canonical_name
    return col_name


def _resolve_column_order(schemas: List[SchemaDefinition], sheet_name: str) -> List[str]:
    for s in schemas:
        if sheet_name in s.sheets:
            sd = s.sheets[sheet_name]
            if sd.column_order:
                return sd.column_order
    return _union_sheet_columns(schemas, sheet_name)


def _convert_time_24h(val: Any) -> Any:
    if isinstance(val, str) and re.match(r'^\d{2}:\d{2}:\d{2}$', val.strip()):
        parts = val.strip().split(':')
        return time(int(parts[0]), int(parts[1]), int(parts[2]))
    return val


def write_consolidated_workbook(
    sheet_data: Dict[str, pd.DataFrame],
    schemas: List[SchemaDefinition],
    output_path: str
) -> str:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    sheet_names = list(sheet_data.keys())
    header_fills = {
        "Payment Tracker": PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid"),
        "Master Data": PatternFill(start_color="366092", end_color="366092", fill_type="solid"),
    }
    default_fill = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")

    for sheet_name, df in sheet_data.items():
        ws = wb.create_sheet(title=sheet_name)

        sheet_def = _first_sheet_def(schemas, sheet_name)
        if not sheet_def:
            continue
        all_columns = _resolve_column_order(schemas, sheet_name)
        if not all_columns:
            continue
        s_no_col = sheet_def.s_no_column
        client_col = sheet_def.client_column
        sum_cols = sheet_def.sum_columns
        hidden_cols = sheet_def.hidden_columns
        header_fill = header_fills.get(sheet_name, default_fill)
        all_col_defs = sheet_def.columns

        for other_schema in schemas:
            if sheet_name in other_schema.sheets:
                for c in other_schema.sheets[sheet_name].columns:
                    if c.canonical_name not in [x.canonical_name for x in all_col_defs]:
                        all_col_defs.append(c)

        for c_idx, col_name in enumerate(all_columns, 1):
            hdr = _header_name(col_name, all_col_defs)
            cell = ws.cell(row=1, column=c_idx, value=hdr)
            format_cell(
                cell, bold=True, color="FFFFFF", fill=header_fill,
                alignment=Alignment(horizontal="center", vertical="center", wrap_text=True)
            )
        ws.row_dimensions[1].height = 28 if sheet_name == "Payment Tracker" else 32

        current_row = 2
        for seq, (_, row_data) in enumerate(df.iterrows(), 1):
            # Renumber s_no_column sequentially
            if s_no_col and s_no_col in all_columns:
                row_data = row_data.copy()
                row_data[s_no_col] = seq
            for c_idx, col_name in enumerate(all_columns, 1):
                val = row_data.get(col_name, None)
                if isinstance(val, str) and not pd.isna(val):
                    val = val.rstrip()
                    if re.match(r'^\d{1,9}$', val):
                        try:
                            val = int(val)
                        except (ValueError, TypeError):
                            pass
                    else:
                        parsed = _convert_time_24h(val)
                        if isinstance(parsed, time):
                            val = parsed
                        else:
                            try:
                                val = datetime.strptime(val, "%Y-%m-%d")
                            except (ValueError, TypeError):
                                pass
                if isinstance(val, time) and not pd.isna(val):
                    cell = ws.cell(row=current_row, column=c_idx, value=val)
                    cell.alignment = Alignment(horizontal="center")
                    cell.number_format = "hh:mm AM/PM"
                elif isinstance(val, (datetime, date)) and not pd.isna(val):
                    cell = ws.cell(row=current_row, column=c_idx, value=val)
                    cell.alignment = Alignment(horizontal="center")
                    if isinstance(val, datetime) and (val.year == 1899 or val.year == 1900 or "time" in col_name.lower() or "reporting" in col_name.lower()):
                        cell.number_format = "hh:mm AM/PM"
                    else:
                        cell.number_format = "DD-MM-YYYY"
                elif isinstance(val, (datetime, date, time)) and pd.isna(val):
                    cell = ws.cell(row=current_row, column=c_idx, value=None)
                else:
                    cell = ws.cell(row=current_row, column=c_idx, value=val)
                    if isinstance(val, (int, float)) and not pd.isna(val):
                        cell.number_format = "#,##0.00" if isinstance(val, float) else "0"
                        cell.alignment = Alignment(horizontal="right")
                    else:
                        cell.alignment = Alignment(horizontal="left")

            ws.row_dimensions[current_row].height = 20 if sheet_name == "Payment Tracker" else 18
            current_row += 1

        data_end_row = current_row - 1

        if sum_cols:
            total_row = data_end_row + 2
            sum_end_row = data_end_row + 1
            cell_tot_lbl = ws.cell(row=total_row, column=1, value="")
            format_cell(cell_tot_lbl, bold=True, alignment=Alignment(horizontal="center"))

            for sum_col in sum_cols:
                if sum_col in all_columns:
                    col_idx = all_columns.index(sum_col) + 1
                    col_letter = get_column_letter(col_idx)
                    cell = ws.cell(
                        row=total_row, column=col_idx,
                        value=f"=SUM({col_letter}2:{col_letter}{sum_end_row})"
                    )
                    format_cell(cell, bold=True, number_format="#,##0.00", alignment=Alignment(horizontal="right"))

            ws.row_dimensions[total_row].height = 22
            double_bottom_border = Border(
                top=Side(style='thin', color='000000'),
                bottom=Side(style='double', color='000000')
            )
            for c in range(1, len(all_columns) + 1):
                ws.cell(row=total_row, column=c).border = double_bottom_border

        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = min(max(max_len + 3, 10), 30)

        for c_idx in hidden_cols:
            col_letter = get_column_letter(c_idx)
            if col_letter in ws.column_dimensions:
                ws.column_dimensions[col_letter].hidden = True
            else:
                ws.column_dimensions[col_letter].hidden = True

    wb.save(output_path)
    print(f"Consolidated workbook written successfully to: {output_path}")
    return output_path
