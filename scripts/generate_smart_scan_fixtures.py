import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_DIR = os.path.join(ROOT_DIR, "output", "pdf")
IMAGE_DIR = os.path.join(ROOT_DIR, "output", "images")
FIXTURE_DIR = os.path.join(ROOT_DIR, "output", "smart-scan-fixtures")
QUESTION_PDF = os.path.join(PDF_DIR, "SPVN_30Q_Question_Paper.pdf")
ANSWER_PDF = os.path.join(PDF_DIR, "SPVN_30Q_Answer_Key.pdf")
PHOTO_JPG = os.path.join(IMAGE_DIR, "SPVN_10Q_Handwritten_Photo.jpg")
MANIFEST_JSON = os.path.join(FIXTURE_DIR, "SPVN_SmartScan_Manifest.json")

for output_dir in [PDF_DIR, IMAGE_DIR, FIXTURE_DIR]:
    os.makedirs(output_dir, exist_ok=True)


PDF_QUESTIONS = [
    ("What is 12 + 8?", ["18", "20", "22", "24"], "B", "12 + 8 equals 20."),
    ("Which chemical formula represents water?", ["CO2", "O2", "H2O", "NaCl"], "C", "Water is H2O."),
    ("Which planet is known as the Red Planet?", ["Earth", "Venus", "Mars", "Jupiter"], "C", "Mars appears red due to iron oxides."),
    ("What is the SI unit of force?", ["Joule", "Newton", "Watt", "Pascal"], "B", "Force is measured in newtons."),
    ("Which gas do plants absorb during photosynthesis?", ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], "C", "Plants absorb carbon dioxide."),
    ("What is 9 multiplied by 7?", ["56", "63", "72", "81"], "B", "9 x 7 equals 63."),
    ("Which organ pumps blood through the human body?", ["Brain", "Lungs", "Heart", "Kidney"], "C", "The heart pumps blood."),
    ("What is the capital of Maharashtra?", ["Pune", "Nagpur", "Nashik", "Mumbai"], "D", "Mumbai is the capital of Maharashtra."),
    ("Which number is a prime number?", ["21", "27", "29", "33"], "C", "29 has only two factors."),
    ("What is the boiling point of water at sea level?", ["50 C", "75 C", "100 C", "125 C"], "C", "Water boils at 100 C at sea level."),
    ("Which part of a plant performs most photosynthesis?", ["Root", "Stem", "Leaf", "Flower"], "C", "Leaves contain chlorophyll."),
    ("What is 144 divided by 12?", ["10", "11", "12", "13"], "C", "144 / 12 equals 12."),
    ("Which is the largest ocean on Earth?", ["Indian", "Atlantic", "Arctic", "Pacific"], "D", "The Pacific is the largest ocean."),
    ("Which vitamin is mainly produced when skin receives sunlight?", ["Vitamin A", "Vitamin B12", "Vitamin C", "Vitamin D"], "D", "Sunlight supports Vitamin D production."),
    ("What is the square of 15?", ["125", "200", "225", "250"], "C", "15 x 15 equals 225."),
    ("Which metal is liquid near room temperature?", ["Iron", "Mercury", "Copper", "Aluminium"], "B", "Mercury is liquid near room temperature."),
    ("Who wrote the Indian national anthem?", ["Rabindranath Tagore", "Bankim Chandra", "Sarojini Naidu", "Premchand"], "A", "Rabindranath Tagore wrote Jana Gana Mana."),
    ("How many sides does a hexagon have?", ["5", "6", "7", "8"], "B", "A hexagon has six sides."),
    ("Which blood cells help fight infection?", ["Red cells", "White cells", "Platelets", "Plasma"], "B", "White blood cells fight infection."),
    ("What is the value of pi rounded to two decimals?", ["3.12", "3.14", "3.16", "3.18"], "B", "Pi rounded to two decimals is 3.14."),
    ("Which instrument measures temperature?", ["Barometer", "Thermometer", "Ammeter", "Speedometer"], "B", "A thermometer measures temperature."),
    ("What is 5 cubed?", ["25", "75", "100", "125"], "D", "5 x 5 x 5 equals 125."),
    ("Which is the smallest continent by land area?", ["Europe", "Australia", "Antarctica", "South America"], "B", "Australia is the smallest continent."),
    ("Which layer protects Earth from much ultraviolet radiation?", ["Troposphere", "Ozone layer", "Core", "Mantle"], "B", "The ozone layer absorbs much UV radiation."),
    ("What is 30 percent of 200?", ["40", "50", "60", "70"], "C", "30 percent of 200 is 60."),
    ("Which device converts electrical energy into mechanical energy?", ["Generator", "Motor", "Transformer", "Cell"], "B", "An electric motor produces mechanical motion."),
    ("Which language is primarily used to style web pages?", ["HTML", "CSS", "SQL", "Python"], "B", "CSS styles web pages."),
    ("What is the HCF of 18 and 24?", ["3", "6", "9", "12"], "B", "The highest common factor is 6."),
    ("Which is a renewable source of energy?", ["Coal", "Petroleum", "Solar energy", "Natural gas"], "C", "Solar energy is renewable."),
    ("How many degrees are in a right angle?", ["45", "60", "90", "180"], "C", "A right angle measures 90 degrees."),
]


PHOTO_QUESTIONS = [
    ("What is 25 + 17?", ["40", "42", "43", "44"], "B"),
    ("Which animal is called the ship of the desert?", ["Horse", "Camel", "Elephant", "Yak"], "B"),
    ("What is the opposite of ancient?", ["Modern", "Old", "Historic", "Past"], "A"),
    ("Which gas is essential for human respiration?", ["Oxygen", "Carbon dioxide", "Helium", "Methane"], "A"),
    ("What is 8 squared?", ["16", "32", "64", "80"], "C"),
    ("Which country is famous for the pyramids of Giza?", ["India", "Egypt", "Japan", "Brazil"], "B"),
    ("How many minutes are in two hours?", ["60", "90", "120", "180"], "C"),
    ("Which sense organ is used for hearing?", ["Eye", "Nose", "Ear", "Skin"], "C"),
    ("What is the next number: 2, 4, 6, 8, ?", ["9", "10", "11", "12"], "B"),
    ("Which shape has three sides?", ["Square", "Circle", "Triangle", "Rectangle"], "C"),
]


def register_fonts():
    regular_candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    bold_candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    regular_path = next(path for path in regular_candidates if os.path.exists(path))
    bold_path = next(path for path in bold_candidates if os.path.exists(path))
    pdfmetrics.registerFont(TTFont("FixtureRegular", regular_path))
    pdfmetrics.registerFont(TTFont("FixtureBold", bold_path))


def draw_page_header(pdf_canvas, title, page_number, page_count):
    page_width, page_height = A4
    pdf_canvas.setFillColor(colors.HexColor("#172554"))
    pdf_canvas.rect(0, page_height - 54, page_width, 54, stroke=0, fill=1)
    pdf_canvas.setFillColor(colors.white)
    pdf_canvas.setFont("FixtureBold", 15)
    pdf_canvas.drawString(32, page_height - 34, title)
    pdf_canvas.setFont("FixtureRegular", 8.5)
    pdf_canvas.drawRightString(page_width - 32, page_height - 33, f"Page {page_number} of {page_count}")


def generate_question_pdf():
    pdf_canvas = canvas.Canvas(QUESTION_PDF, pagesize=A4)
    page_width, page_height = A4
    for page_index in range(3):
        draw_page_header(pdf_canvas, "SPVN Smart Scan QA - Question Paper", page_index + 1, 3)
        pdf_canvas.setFillColor(colors.HexColor("#334155"))
        pdf_canvas.setFont("FixtureRegular", 8.5)
        pdf_canvas.drawString(32, page_height - 70, "Each page contains 10 MCQs. Choose one correct option for every question.")
        y_position = page_height - 92
        start_index = page_index * 10
        for local_index, item in enumerate(PDF_QUESTIONS[start_index:start_index + 10], start=1):
            question, options, _, _ = item
            question_number = start_index + local_index
            pdf_canvas.setFillColor(colors.HexColor("#F8FAFC"))
            pdf_canvas.roundRect(30, y_position - 58, page_width - 60, 62, 6, stroke=0, fill=1)
            pdf_canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
            pdf_canvas.roundRect(30, y_position - 58, page_width - 60, 62, 6, stroke=1, fill=0)
            pdf_canvas.setFillColor(colors.HexColor("#0F172A"))
            pdf_canvas.setFont("FixtureBold", 9.2)
            pdf_canvas.drawString(40, y_position - 13, f"{question_number}. {question}")
            pdf_canvas.setFont("FixtureRegular", 8.4)
            option_text = "     ".join(
                f"{letter}) {option}" for letter, option in zip(["A", "B", "C", "D"], options)
            )
            pdf_canvas.drawString(52, y_position - 37, option_text)
            y_position -= 68
        pdf_canvas.setFillColor(colors.HexColor("#64748B"))
        pdf_canvas.setFont("FixtureRegular", 7.5)
        pdf_canvas.drawCentredString(page_width / 2, 18, "Generated for SPVN Smart Question Scan end-to-end testing")
        pdf_canvas.showPage()
    pdf_canvas.save()


def generate_answer_pdf():
    pdf_canvas = canvas.Canvas(ANSWER_PDF, pagesize=A4)
    page_width, page_height = A4
    for page_index in range(3):
        draw_page_header(pdf_canvas, "SPVN Smart Scan QA - Model Answer Key", page_index + 1, 3)
        pdf_canvas.setFillColor(colors.HexColor("#334155"))
        pdf_canvas.setFont("FixtureRegular", 8.5)
        pdf_canvas.drawString(32, page_height - 70, "Answers correspond to the matching question numbers in the question paper.")
        y_position = page_height - 94
        start_index = page_index * 10
        for local_index, item in enumerate(PDF_QUESTIONS[start_index:start_index + 10], start=1):
            _, options, answer, explanation = item
            question_number = start_index + local_index
            answer_index = ["A", "B", "C", "D"].index(answer)
            pdf_canvas.setFillColor(colors.HexColor("#ECFDF5"))
            pdf_canvas.roundRect(34, y_position - 50, page_width - 68, 54, 6, stroke=0, fill=1)
            pdf_canvas.setStrokeColor(colors.HexColor("#A7F3D0"))
            pdf_canvas.roundRect(34, y_position - 50, page_width - 68, 54, 6, stroke=1, fill=0)
            pdf_canvas.setFillColor(colors.HexColor("#065F46"))
            pdf_canvas.setFont("FixtureBold", 10)
            pdf_canvas.drawString(46, y_position - 16, f"Q{question_number}: {answer} - {options[answer_index]}")
            pdf_canvas.setFillColor(colors.HexColor("#334155"))
            pdf_canvas.setFont("FixtureRegular", 8.2)
            pdf_canvas.drawString(46, y_position - 36, explanation)
            y_position -= 62
        pdf_canvas.setFillColor(colors.HexColor("#64748B"))
        pdf_canvas.setFont("FixtureRegular", 7.5)
        pdf_canvas.drawCentredString(page_width / 2, 18, "Generated for SPVN Smart Question Scan end-to-end testing")
        pdf_canvas.showPage()
    pdf_canvas.save()


def fit_font(draw_context, text, font_path, maximum_size, maximum_width):
    font_size = maximum_size
    while font_size >= 24:
        font = ImageFont.truetype(font_path, font_size)
        if draw_context.textbbox((0, 0), text, font=font)[2] <= maximum_width:
            return font
        font_size -= 1
    return ImageFont.truetype(font_path, 24)


def generate_handwritten_photo():
    random.seed(20260730)
    paper_width = 2400
    paper_height = 3300
    paper = Image.new("RGB", (paper_width, paper_height), (251, 248, 235))
    draw_context = ImageDraw.Draw(paper)
    for y_position in range(185, paper_height - 100, 72):
        draw_context.line((80, y_position, paper_width - 80, y_position), fill=(186, 214, 234), width=2)
    draw_context.line((145, 95, 145, paper_height - 95), fill=(236, 155, 155), width=4)

    hand_font_path = "/System/Library/Fonts/Noteworthy.ttc"
    bold_font_path = "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf"
    title_font = ImageFont.truetype(bold_font_path, 64)
    question_font = ImageFont.truetype(bold_font_path, 36)
    option_font = ImageFont.truetype(hand_font_path, 31)
    answer_font = ImageFont.truetype(bold_font_path, 34)

    draw_context.text((190, 72), "SPVN - Handwritten MCQ Practice Photo", font=title_font, fill=(30, 41, 59))
    draw_context.text((190, 145), "10 questions on one photographed page", font=option_font, fill=(69, 80, 99))

    column_left = [190, 1260]
    column_width = 960
    start_y = 250
    block_height = 545
    for question_index, item in enumerate(PHOTO_QUESTIONS):
        question, options, _ = item
        column_index = 0 if question_index < 5 else 1
        row_index = question_index if question_index < 5 else question_index - 5
        x_position = column_left[column_index] + random.randint(-6, 6)
        y_position = start_y + row_index * block_height + random.randint(-4, 4)
        question_text = f"{question_index + 1}) {question}"
        adjusted_font = fit_font(draw_context, question_text, bold_font_path, 36, column_width)
        draw_context.text((x_position, y_position), question_text, font=adjusted_font, fill=(34, 44, 65))
        option_y = y_position + 72
        for option_index, option in enumerate(options):
            letter = ["A", "B", "C", "D"][option_index]
            option_x = x_position + (option_index % 2) * 450
            option_line_y = option_y + (option_index // 2) * 65
            draw_context.text((option_x, option_line_y), f"{letter}) {option}", font=option_font, fill=(45, 55, 75))

    answers = "Answers: " + "  ".join(
        f"{index + 1}-{item[2]}" for index, item in enumerate(PHOTO_QUESTIONS)
    )
    draw_context.rounded_rectangle((190, 3030, 2210, 3170), radius=26, fill=(255, 248, 208), outline=(224, 180, 62), width=4)
    draw_context.text((235, 3071), answers, font=answer_font, fill=(124, 77, 18))

    noise_overlay = Image.new("RGBA", paper.size, (0, 0, 0, 0))
    noise_draw = ImageDraw.Draw(noise_overlay)
    for _ in range(9000):
        x_position = random.randrange(paper_width)
        y_position = random.randrange(paper_height)
        shade = random.randrange(170, 235)
        noise_draw.point((x_position, y_position), fill=(shade, shade, shade, 15))
    paper = Image.alpha_composite(paper.convert("RGBA"), noise_overlay).convert("RGB")

    rotated = paper.rotate(0.7, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(48, 52, 58))
    background = Image.new("RGB", (rotated.width + 180, rotated.height + 180), (48, 52, 58))
    shadow = Image.new("RGBA", rotated.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rectangle((25, 25, rotated.width - 5, rotated.height - 5), fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(30))
    background.paste(shadow, (90, 90), shadow)
    background.paste(rotated, (70, 65))
    background.save(PHOTO_JPG, "JPEG", quality=94, subsampling=0, dpi=(300, 300))


def write_manifest():
    manifest = {
        "question_pdf": QUESTION_PDF,
        "answer_pdf": ANSWER_PDF,
        "photo": PHOTO_JPG,
        "pdf_questions": [
            {
                "number": index + 1,
                "question": question,
                "options": options,
                "correctAnswer": answer,
                "explanation": explanation,
            }
            for index, (question, options, answer, explanation) in enumerate(PDF_QUESTIONS)
        ],
        "photo_questions": [
            {
                "number": index + 1,
                "question": question,
                "options": options,
                "correctAnswer": answer,
            }
            for index, (question, options, answer) in enumerate(PHOTO_QUESTIONS)
        ],
    }
    with open(MANIFEST_JSON, "w", encoding="utf-8") as manifest_file:
        json.dump(manifest, manifest_file, indent=2)


if __name__ == "__main__":
    register_fonts()
    generate_question_pdf()
    generate_answer_pdf()
    generate_handwritten_photo()
    write_manifest()
    print(QUESTION_PDF)
    print(ANSWER_PDF)
    print(PHOTO_JPG)
    print(MANIFEST_JSON)
