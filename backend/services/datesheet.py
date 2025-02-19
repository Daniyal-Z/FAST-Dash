import pandas as pd
import logging

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def load_datesheet(file_path):
    """Loads the date sheet from an Excel file and cleans it."""
    df = pd.read_excel(file_path, sheet_name="Complete", header=2)
    if df.iloc[0].isna().sum() > len(df.columns) // 2:
        df = df.iloc[1:].reset_index(drop=True)
    df.iloc[:, :2] = df.iloc[:, :2].ffill()
    return df

def get_courses_with_codes(df):
    """Extracts unique courses along with their codes."""
    courses = df.iloc[:, 2:].dropna(how="all").values.flatten()
    course_data = set()
    
    for i in range(0, len(courses) - 1, 2):  # Ensure course_code and course_name pairing
        course_code, course_name = courses[i], courses[i + 1]
        if isinstance(course_code, str) and isinstance(course_name, str):
            course_data.add((course_code.strip(), course_name.strip()))

    return [{"code": code, "name": name} for code, name in sorted(course_data)]


# def filter_datesheet(df, course_list):
#     """Filters the date sheet for specific courses."""
#     normalized_courses = {course.strip().lower() for course in course_list}
#     extracted_data = []
#     time_slots = df.columns[2:]

#     for _, row in df.iterrows():
#         day, date = row.iloc[:2]
#         for i in range(2, len(row), 2):
#             if i + 1 >= len(row): break
#             course_code, course_name = row.iloc[i], row.iloc[i + 1]
#             time_slot = df.columns[i + 1]
#             if isinstance(course_name, str):
#                 extracted_data.append([day, date, time_slot, course_code, course_name])

#     extracted_df = pd.DataFrame(extracted_data, columns=["Day", "Date", "Time Slot", "Course Code", "Course Name"])
#     extracted_df["Normalized Course Name"] = extracted_df["Course Name"].str.strip().str.lower()
#     filtered_df = extracted_df[extracted_df["Normalized Course Name"].isin(normalized_courses)].copy()
#     return filtered_df.drop(columns=["Normalized Course Name"])

def filter_datesheet(df, course_list):
    """Filters the date sheet for specific courses."""
    normalized_courses = {course.strip().upper() for course in course_list}  # Convert to uppercase for consistency
    extracted_data = []
    
    for _, row in df.iterrows():
        day, date = row.iloc[:2]

         # Normalize date format
        try:
            date = pd.to_datetime(date, dayfirst=True).strftime('%d-%b-%Y')  # Converts to "25-Feb-2025" format
        except Exception:
            pass  # In case of invalid dates, keep them as is

        for i in range(2, len(row), 2):
            if i + 1 >= len(row):
                break

            course_code, course_name = row.iloc[i], row.iloc[i + 1]
            time_slot = df.columns[i + 1]

            if isinstance(course_code, str):  # Ensure it's a valid string
                extracted_data.append([day, date, time_slot, course_code.strip().upper(), course_name])

    extracted_df = pd.DataFrame(extracted_data, columns=["Day", "Date", "Time Slot", "Course Code", "Course Name"])
    
    # Now filter by **course codes** instead of course names
    filtered_df = extracted_df[extracted_df["Course Code"].isin(normalized_courses)].copy()
    
    return filtered_df

def extract_time_slots(df):
    """
    Extracts and sorts unique time slots from the column headers of the DataFrame.
    """
    # Extract time slots from column headers
    time_slots = []
    for col in df.columns[2:]:  # Skip the first two columns (Day and Date)
        if " - " in col:  # Check if the column represents a time slot
            time_slots.append(col)

    # Sort time slots in chronological order
    time_slots.sort()

    return time_slots


