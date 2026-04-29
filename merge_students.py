import pandas as pd
import glob
import os
import re

# 1. กำหนดโฟลเดอร์ที่เก็บไฟล์
folder_path = 'csv_files'
all_files = glob.glob(os.path.join(folder_path, "*.csv"))
master_list = []

print(f"พบไฟล์ทั้งหมด {len(all_files)} ไฟล์ กำลังเริ่มประมวลผล...")

for filename in all_files:
    try:
        # --- ขั้นตอนที่ 1: ตรวจสอบและอ่านไฟล์ด้วย Encoding ที่ถูกต้อง ---
        content = None
        # ลองอ่านด้วย UTF-8 ก่อน (เพราะไฟล์ใหม่ๆ มักจะเป็นอันนี้)
        for enc in ['utf-8-sig', 'utf-8', 'cp874']:
            try:
                with open(filename, 'r', encoding=enc, errors='replace') as f:
                    lines = [line.strip().split(',') for line in f.readlines()]
                if any("รหัสประจำตัว" in ",".join(l) for l in lines):
                    content = lines
                    break
            except:
                continue
        
        if content is None:
            print(f"❌ ข้ามไฟล์ {os.path.basename(filename)}: อ่านไฟล์ไม่ได้หรือหาหัวตารางไม่เจอ")
            continue

        df_raw = pd.DataFrame(content)

        # --- ขั้นตอนที่ 2: ค้นหาตำแหน่ง Metadata และ Header ---
        group_id, level, year, room, advisor_name = "", "", "", "", "ไม่ระบุ"
        header_index = -1
        actual_columns = []

        for i, row in df_raw.iterrows():
            row_list = [str(c).strip() for c in row]
            row_str = ",".join(row_list)

            # ค้นหารหัสกลุ่มเรียน
            if "รหัสกลุ่มเรียน" in row_str:
                for idx, cell in enumerate(row_list):
                    if cell == "รหัสกลุ่มเรียน" and idx + 2 < len(row_list):
                        group_id = row_list[idx + 2]

            # ค้นหาชั้นปี และ ครูที่ปรึกษา
            if "ชั้นปี" in row_str:
                for idx, cell in enumerate(row_list):
                    if cell == "ชั้นปี" and idx + 2 < len(row_list):
                        class_info = row_list[idx + 2]
                        match = re.search(r"([ปวชส.]+)(\d+)/(\d+)", class_info)
                        if match:
                            level, year, room = match.groups()
                        else:
                            level = class_info
                    if "ครูที่ปรึกษา" in cell and idx + 1 < len(row_list):
                        val = row_list[idx + 1].strip()
                        if val: advisor_name = val

            # ค้นหาบรรทัดหัวตาราง (หาคำที่ใกล้เคียงที่สุด)
            if any("รหัสประจำตัว" in c for c in row_list) and any("ชื่อ - สกุล" in c for c in row_list):
                header_index = i
                actual_columns = row_list
                break

        # --- ขั้นตอนที่ 3: ดึงข้อมูลนักเรียน ---
        if header_index != -1:
            df_students = df_raw.iloc[header_index + 1:].copy()
            df_students.columns = actual_columns
            
            # สร้างตารางผลลัพธ์ที่สะอาด
            temp_df = pd.DataFrame()
            
            # ฟังก์ชันช่วยหาคอลัมน์แบบยืดหยุ่น
            def get_col_data(keywords):
                for col in df_students.columns:
                    if any(k in col for k in keywords):
                        return df_students[col].str.strip()
                return ""

            temp_df['student_id'] = get_col_data(["รหัสประจำตัว"])
            temp_df['national_id'] = get_col_data(["รหัสประชาชน"])
            temp_df['full_name'] = get_col_data(["ชื่อ - สกุล"])
            
            # เติมข้อมูลส่วนกลาง
            temp_df['level'] = level
            temp_df['year'] = year
            temp_df['room'] = room
            temp_df['group_id'] = group_id
            temp_df['advisor_name'] = advisor_name
            temp_df['advisor_email'] = "" 

            master_list.append(temp_df)
            print(f"✅ สำเร็จ: {os.path.basename(filename)} -> {level}{year}/{room} ({len(temp_df)} คน)")
        else:
            print(f"⚠️ ไฟล์ {os.path.basename(filename)}: หาแถวที่มี 'รหัสประจำตัว' ไม่เจอ")

    except Exception as e:
        print(f"🔥 พบปัญหาที่ไฟล์ {os.path.basename(filename)}: {str(e)}")

# --- ขั้นตอนที่ 4: รวมร่างและบันทึก ---
if master_list:
    final_df = pd.concat(master_list, ignore_index=True)
    # กรองเฉพาะแถวที่มีรหัสนักเรียนจริงๆ (ตัวเลขมากกว่า 5 หลัก)
    final_df = final_df[final_df['student_id'].str.contains(r'\d{5,}', na=False)]
    
    output_name = 'Master_Students_Final.xlsx'
    final_df.to_excel(output_name, index=False)
    print("\n" + "⭐"*15)
    print(f"ภารกิจสำเร็จ! รวมนักเรียนได้ทั้งหมด {len(final_df)} คน")
    print(f"ไฟล์พร้อมใช้งานที่: {output_name}")
    print("⭐"*15)
else:
    print("❌ ไม่สามารถดึงข้อมูลได้เลย กรุณาตรวจสอบว่าไฟล์ CSV อยู่ในโฟลเดอร์ csv_files หรือไม่")