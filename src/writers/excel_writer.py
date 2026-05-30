import os
import openpyxl
import pandas as pd
from datetime import datetime, date
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

        all_columns = _union_sheet_columns(schemas, sheet_name)
        sheet_def = _first_sheet_def(schemas, sheet_name)
        if not sheet_def or not all_columns:
            continue

        all_columns = [c.canonical_name for c in sheet_def.columns]
        s_no_col = sheet_def.s_no_column
        client_col = sheet_def.client_column
        sum_cols = sheet_def.sum_columns
        hidden_cols = sheet_def.hidden_columns
        header_fill = header_fills.get(sheet_name, default_fill)

        for c_idx, col_name in enumerate(all_columns, 1):
            cell = ws.cell(row=1, column=c_idx, value=col_name)
            format_cell(
                cell, bold=True, color="FFFFFF", fill=header_fill,
                alignment=Alignment(horizontal="center", vertical="center", wrap_text=True)
            )
        ws.row_dimensions[1].height = 28 if sheet_name == "Payment Tracker" else 32

        current_row = 2
        for _, row_data in df.iterrows():
            for c_idx, col_name in enumerate(all_columns, 1):
                val = row_data.get(col_name, None)
                if isinstance(val, (datetime, date)) and not pd.isna(val):
                    cell = ws.cell(row=current_row, column=c_idx, value=val.strftime("%Y-%m-%d"))
                    cell.alignment = Alignment(horizontal="center")
                elif isinstance(val, (datetime, date)) and pd.isna(val):
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
            cell_tot_lbl = ws.cell(row=total_row, column=1, value="Total")
            format_cell(cell_tot_lbl, bold=True, alignment=Alignment(horizontal="center"))

            for sum_col in sum_cols:
                if sum_col in all_columns:
                    col_idx = all_columns.index(sum_col) + 1
                    col_letter = get_column_letter(col_idx)
                    cell = ws.cell(
                        row=total_row, column=col_idx,
                        value=f"=SUM({col_letter}2:{col_letter}{data_end_row})"
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
